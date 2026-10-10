#!/bin/sh
# Install rhapsode from the published image, or bring an install up to date. docs/operating.md § Docker.
#
#   curl -fsSL https://github.com/maroonedsoftware/rhapsode/releases/latest/download/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --lan --dir /srv/rhapsode
#
# Run it again, from the same directory, to upgrade. It replaces the compose files with the
# release's, because a compose.yaml is otherwise downloaded once and never refreshed: an install
# from before 0.1.24 named a registry 0.1.24 was never published to, and its `docker compose pull`
# found nothing and said nothing. What is the install's own (the version pin, the files to
# merge, ports, the uid) lives in .env, which this writes once and afterwards changes only where a
# flag says to. A compose file that differs from the release's is kept beside it, dated, not lost.
#
#   --dir DIR        where the install lives. Default: here if compose.yaml is here, else ./rhapsode
#   --gpu, --no-gpu  merge compose.gpu.yaml, or not. Default on a new install: whether Docker has the
#                    NVIDIA runtime and nvidia-smi sees a card
#   --lan, --no-lan  publish both ports on every interface (compose.lan.yaml), or on 127.0.0.1 only
#   --version TAG    the image tag for RHAPSODE_VERSION: a minor line (0.1), a release, or latest
#   --no-start       write the files, and pull and start nothing
#
# POSIX sh rather than bash, because the boxes this runs on (unraid, a NAS) do not all have bash.

set -eu

BASE="${RHAPSODE_RELEASE_URL:-https://github.com/maroonedsoftware/rhapsode/releases/latest/download}"
dir=""
gpu=""
lan=""
version=""
start=1

say() { printf '%s\n' "$*"; }
usage() {
    cat <<'USAGE'
Install rhapsode from the published image, or run it again in the same directory to upgrade.

  --dir DIR        where the install lives. Default: here if compose.yaml is here, else ./rhapsode
  --gpu, --no-gpu  merge compose.gpu.yaml, or not. A new install decides from the NVIDIA runtime
  --lan, --no-lan  publish both ports on every interface (compose.lan.yaml), or on 127.0.0.1 only
  --version TAG    the image tag for RHAPSODE_VERSION: a minor line (0.1), a release, or latest
  --no-start       write the files, and pull and start nothing
USAGE
}
fail() {
    printf 'rhapsode install: %s\n' "$*" >&2
    exit 1
}

while [ $# -gt 0 ]; do
    case "$1" in
        --dir)
            [ $# -ge 2 ] || fail "--dir needs a directory"
            dir="$2"
            shift
            ;;
        --gpu) gpu=1 ;;
        --no-gpu) gpu=0 ;;
        --lan) lan=1 ;;
        --no-lan) lan=0 ;;
        --version)
            [ $# -ge 2 ] || fail "--version needs a tag, such as 0.1"
            version="$2"
            shift
            ;;
        --no-start) start=0 ;;
        -h | --help)
            usage
            exit 0
            ;;
        *) fail "unknown option $1 (--help lists them)" ;;
    esac
    shift
done

command -v docker >/dev/null 2>&1 || fail "docker is not installed"
docker compose version >/dev/null 2>&1 || fail "the Docker Compose plugin is not installed (\`docker compose version\` failed)"
if command -v curl >/dev/null 2>&1; then
    fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
    fetch() { wget -q "$1" -O "$2"; }
else
    fail "neither curl nor wget is installed"
fi

if [ -z "$dir" ]; then
    if [ -f compose.yaml ]; then dir=.; else dir=rhapsode; fi
fi
mkdir -p "$dir"
cd "$dir"
say "rhapsode in $(pwd)"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
work=$(mktemp -d "${TMPDIR:-/tmp}/rhapsode-install.XXXXXX")
trap 'rm -rf "$work"' EXIT

# Every file first, so a download that fails half way leaves the install as it was.
for name in compose.yaml compose.gpu.yaml compose.lan.yaml env.example; do
    fetch "$BASE/$name" "$work/$name" || fail "could not download $BASE/$name"
done
for name in compose.yaml compose.gpu.yaml compose.lan.yaml; do
    if [ -f "$name" ] && ! cmp -s "$name" "$work/$name"; then
        mv "$name" "$name.before-$stamp"
        say "  kept your $name as $name.before-$stamp"
    fi
    mv "$work/$name" "$name"
done

# A line of .env set to a value, added where it is missing. Written through a copy rather than
# `sed -i`, which GNU and BSD spell differently.
set_env() {
    if grep -q "^$1=" .env; then
        sed "s|^$1=.*|$1=$2|" .env >"$work/env" && cat "$work/env" >.env
    else
        printf '%s=%s\n' "$1" "$2" >>.env
    fi
}

has_nvidia() {
    command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1 &&
        docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q nvidia
}

if [ -f .env ]; then
    current=$(sed -n 's/^COMPOSE_FILE=//p' .env | tail -n 1)
    [ -n "$current" ] || current=compose.yaml
else
    mv "$work/env.example" .env
    chmod 600 .env
    current=compose.yaml
    # A new install decides the GPU for itself when no flag did.
    if [ -z "$gpu" ]; then
        if has_nvidia; then gpu=1; else gpu=0; fi
    fi
    say "  wrote .env"
fi

# COMPOSE_FILE with each override in or out as a flag said, and as it was where none did.
files=compose.yaml
# Each named by the flag, or kept as it was when no flag named it.
merges() {
    case ":$current:" in *":$1:"*) [ "$2" != 0 ] ;; *) [ "$2" = 1 ] ;; esac
}
if merges compose.gpu.yaml "$gpu"; then files="$files:compose.gpu.yaml"; fi
if merges compose.lan.yaml "$lan"; then files="$files:compose.lan.yaml"; fi
# Anything else the operator merges stays, after ours.
for name in $(printf '%s' "$current" | tr ':' ' '); do
    case "$name" in compose.yaml | compose.gpu.yaml | compose.lan.yaml) ;; *) files="$files:$name" ;; esac
done
set_env COMPOSE_FILE "$files"
[ -z "$version" ] || set_env RHAPSODE_VERSION "$version"

say "  COMPOSE_FILE=$files"
pin=$(sed -n 's/^RHAPSODE_VERSION=//p' .env | tail -n 1)
say "  RHAPSODE_VERSION=${pin:-unset, so the minor line compose.yaml names}"
case ":$files:" in *:compose.lan.yaml:*)
    say "  Both ports are published on every interface. Add the page's origin, such as http://$(hostname):8081,"
    say "  to management.origins under Settings, or the core refuses the page from another machine."
    ;;
esac

if [ "$start" = 0 ]; then
    say "Not started. \`docker compose up -d\` here starts it."
    exit 0
fi

docker compose pull -q
docker compose up -d --wait
port=$(sed -n 's/^RHAPSODE_WEB_PORT=//p' .env | tail -n 1)
say "rhapsode is running. The page: http://localhost:${port:-8081}"
