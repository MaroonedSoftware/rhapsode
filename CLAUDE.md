# Working in this repository

`docs/protocol.md` is the specification and it outranks the code. If the code disagrees with it, one
of them is a bug; decide which, and fix that one. If the spec is silent on something you had to
decide, the decision belongs in the spec before it belongs in a file.

## The shape

Two languages, one protocol.

- `contracts/*.ck` is the source of truth for every request and response shape. It compiles to zod
  and TypeScript for the core, Pydantic models for the Python SDK, and an OpenAPI document. Generated
  output is **committed**, because the Python half has no Node toolchain at install time and cannot
  generate on demand. `pnpm codegen:check` fails when it has drifted.
- `packages/contract` depends on zod and nothing else. Keep it that way: it is the package a client
  SDK or a shim adopts on its own, and a ServerKit dependency in it would defeat that.
- `packages/core` is the server. It never imports torch and holds no engine knowledge. Anything that
  needs to know what an engine can do reads a capability document.
- `python/rhapsode-worker` is the SDK an engine author subclasses. It must never depend on torch
  either, or an ONNX adapter cannot install it.

- `packages/sdk` is a typed client for the public API, generated from the same contracts and
  committed. It depends on nothing, for the same reason `packages/contract` depends only on zod.
- `apps/web` is a web page for installing engines, a client of the management API and nothing the
  wizard lacks. Its rules are in [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md).

Dependency direction is one-way: `apps/server` → `packages/core` → `packages/contract`. The SDK
depends on the core only to test against it.

## Commands

`pnpm test` runs both languages. That is deliberate: one repository only means "the protocol and both
of its implementations move in one commit" if one command tests both.

```bash
pnpm install && pnpm wizard setup   # first time
pnpm dev                            # the server on :8080 from source, restarting on edits; the web page on :8081
pnpm build && pnpm test
node scripts/python.mjs test        # the Python half alone
pnpm wizard doctor                  # what is wrong with this checkout, and --fix for what it can mend
pnpm wizard install kokoro          # with the server running: install an engine through its API
node scripts/docker.smoke.mjs       # build the images, install through them, and restart them on their volumes
pnpm release version 0.2.0          # every published package to one version, changesets into CHANGELOG.md
```

Every published package, npm and PyPI, carries one version (`docs/protocol.md` § 9). `pnpm release`
sets it rather than `changeset version`, because a changeset cannot name a Python package. Write a
changeset as before; pushing a `v*` tag is what publishes, through `.github/workflows/release.yml`:
PyPI first, then the client SDK to npm, both by trusted publishing from the `pypi` and `npm`
environments with no token. PyPI goes first because a core installs its engines from there. A package
new to npm has no trusted publisher yet: `node scripts/npm.bootstrap.mjs` publishes its first
version from the release tag and registers one, run once by hand after that release's `npm` job fails.

`pnpm wizard` is `packages/cli`, a johnny5 CLI like the ones in signet and kanban. It runs from
TypeScript source under swc and is never built. `setup` is interactive and drives the same scripts
listed here rather than duplicating them, so it cannot drift from what CI runs.

`pnpm python:sync` builds `python/.venv` with the three Python packages installed editable. It
prefers `uv` and falls back to the stdlib `venv` module.

If your machine intercepts TLS and pip cannot verify a certificate, set
`RHAPSODE_PIP_TRUSTED_HOSTS=pypi.org,files.pythonhosted.org`. It is an environment variable rather
than a checked-in `pip.conf` on purpose: weakening certificate verification is a local decision and
must not be something anybody inherits by cloning.

## Conventions

These match ServerKit and deadair, and the reason to match them is that all three are read by the
same people.

- ESM only, Node >= 22, TypeScript 6. `tsup` for JS, `tsc --emitDeclarationOnly` for types.
- Tests live in a top-level `tests/` per package, mirroring `src/`, importing `../src/...`. Never
  colocated, and kept out of the build tsconfig so `tsc` only type-checks shippable code.
- Python tests run one pytest invocation per package, because pytest imports `conftest` by module
  name: pointed at several test directories at once, the first `conftest` shadows the rest. Test
  module basenames still need to be distinct within a package.
- Dot-separated lowercase filenames: `worker.supervisor.ts`, `residency.manager.ts`.
- Luxon, never `new Date()` or `Date.now()`.
- `undefined` for "not set", never `null`.
- No em dashes in prose. Restructure instead.
- Changesets for every user-visible change.

## The house style for a comment

The spec says of itself that every rule which looks arbitrary was paid for somewhere else first, and
says where. Comments here work the same way: say what it cost, and cite the measurement. A comment
that only restates the code is noise, and a rule with no reason attached gets deleted by the next
person who finds it inconvenient.
