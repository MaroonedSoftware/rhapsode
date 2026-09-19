# syntax=docker/dockerfile:1

# `--target server` is the whole install: the core, and the page behind nginx in the same container.
# `--target web` is the page alone, for anyone still running it in front of a separate server.
# docs/operating.md § Docker says why each choice here is made.

ARG NODE_VERSION=22
ARG PNPM_VERSION=11.23.0
ARG UV_VERSION=latest

FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

FROM node:${NODE_VERSION}-bookworm AS build
ARG PNPM_VERSION
RUN npm install --global pnpm@${PNPM_VERSION}
WORKDIR /src
COPY . .
RUN --mount=type=cache,id=rhapsode-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm exec turbo run build --filter=./apps/server...
# The server and what it imports, with production dependencies only and the workspace packages
# copied in as real directories rather than links into a tree this stage leaves behind.
RUN --mount=type=cache,id=rhapsode-pnpm,target=/root/.local/share/pnpm/store \
    pnpm --filter ./apps/server deploy --prod --legacy /out

FROM build AS web-build
RUN pnpm exec turbo run build --filter=./apps/web...

# The page is static, and nginx serves it and proxies /api to the core with the management token.
FROM nginx:stable-alpine AS web
ENV RHAPSODE_UPSTREAM=server:8080 \
    RHAPSODE_RESOLVER=127.0.0.11
COPY --from=web-build /src/apps/web/dist /usr/share/nginx/html
COPY docker/web/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=0755 docker/web/15-rhapsode-token.envsh /docker-entrypoint.d/15-rhapsode-token.envsh
# Through the proxy, so healthy means the core is reachable from here and not only that nginx is up.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
    CMD ["wget", "--quiet", "--spider", "http://127.0.0.1/api/health"]

# Debian rather than Alpine: cbor-extract, under ServerKit's authentication package, has no musl
# prebuild, and would need a compiler in the image to build one.
FROM node:${NODE_VERSION}-bookworm-slim AS server

# ffmpeg for mp3, opus and flac, which docs/operating.md § Formats says the SDK cannot frame itself.
# Debian's build has all three encoders. tini because node as PID 1 reaps nothing, and pip and the
# workers leave orphans behind them. No python3, on purpose: see the seeded config in entrypoint.mjs.
# gcc and libc6-dev because Triton, under vLLM, compiles a small C helper the first time a worker
# launches a kernel, and without a C compiler Orpheus's `full` build failed every load with "Failed
# to find C compiler". C only, and no CUDA toolkit: nothing here compiles C++ or CUDA. nginx for the
# page and its proxy, which the entrypoint starts beside the server.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates ffmpeg tini gcc libc6-dev nginx \
    && rm -rf /var/lib/apt/lists/*
COPY --from=uv /uv /usr/local/bin/uv

# The workers' env is constructed and drops LD_LIBRARY_PATH and CUDA_*, but the NVIDIA runtime reads
# this at container creation, not the worker. A CUDA base image sets it; this one has to. Inert
# without a GPU.
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility

# HOME is the downloads volume, because everything an engine fetches already lands under HOME: the
# virtualenvs, uv's interpreters, pip's cache, and each engine's weights. Setting it is what puts all
# of them in a volume without the core or an engine knowing it is in a container.
ENV HOME=/data \
    RHAPSODE_CONFIG=/config/rhapsode.config.json

# 10001 by default. Compose runs it as PUID:PGID instead, which on unraid is 99:100, so both volumes
# are writable by any uid: a named volume keeps the mode it was created with, and a uid that cannot
# write /data fails its first install, deep in a pip traceback.
RUN groupadd --gid 10001 rhapsode \
    && useradd --uid 10001 --gid rhapsode --no-create-home --home-dir /data rhapsode \
    && mkdir -p /config /data \
    && chown rhapsode:rhapsode /config /data \
    && chmod 0777 /config /data

WORKDIR /app
COPY --from=build /out ./
COPY python ./python
COPY --from=web-build /src/apps/web/dist ./web
COPY docker/server/entrypoint.mjs ./docker-entrypoint.mjs
COPY docker/server/nginx.conf.template ./nginx.conf.template

USER rhapsode
VOLUME ["/config", "/data"]
# The API, and the page. The page's port carries the management token to the install routes, so
# compose publishes it on 127.0.0.1 only. docs/operating.md § Docker.
EXPOSE 8080 8081
# Through the page's proxy, so healthy means nginx and the core both answer.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s \
    CMD ["node", "-e", "fetch('http://127.0.0.1:8081/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Exec form, so SIGTERM reaches node and drains as docs/operating.md § Shutting down describes.
ENTRYPOINT ["tini", "--", "node", "/app/docker-entrypoint.mjs"]
