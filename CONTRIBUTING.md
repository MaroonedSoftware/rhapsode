# Contributing

Thank you for considering it. Rhapsode is one protocol with two implementations, a TypeScript server
and a Python SDK, and most of what follows exists to keep those three things agreeing with each
other.

## Before you write code

`docs/protocol.md` is the specification, and it outranks the code. If you find the code disagreeing
with it, one of them is a bug: say which in the issue or pull request. If your change needs a
decision the spec does not make, the decision goes into the spec in the same pull request.

For anything larger than a fix, open an issue first. A change to the protocol affects every engine,
and it is cheaper to disagree about a paragraph than about a finished branch.

Adding an engine is the exception: it is a Python package and needs no change to the core. See
[Contributing an engine](README.md#contributing-an-engine).

## Setting up

You need Node 22 or later, pnpm (the version is pinned in `package.json`, so `corepack enable` is
enough), Python 3.11 or later, and ffmpeg on your `PATH`.

```bash
pnpm install && pnpm wizard setup
```

`pnpm wizard doctor` says what is wrong with a checkout, and `--fix` mends what it can.

## Checking your change

CI runs the same commands, and a pull request needs them to pass before it can merge.

```bash
pnpm run format:check
pnpm run codegen:check
pnpm build && pnpm run typecheck && pnpm run lint
pnpm test
node scripts/conform.mjs
```

`pnpm test` runs both languages. `node scripts/python.mjs test` runs the Python half alone.

## What a pull request needs

- **A changeset** for every user-visible change: `pnpm changeset`. A changeset header cannot name a
  Python package, so for a Python-only change leave the header empty and start the text with the
  package, as in `` `rhapsode-worker`: ... ``. Every package ships at one version, so the header
  decides nothing about numbering anyway.
- **Regenerated contracts** if you edited `contracts/*.ck`: run `pnpm codegen` and commit the output.
  It is committed on purpose, because the Python packages install without a Node toolchain.
- **Tests** in the package's top-level `tests/` folder, mirroring `src/`. Never colocated.
- **Commits that each build.** Several small commits that each leave the tree working are easier to
  review than one large one.

## Conventions

- ESM only, TypeScript 6, Node 22 or later.
- Dot-separated lowercase filenames: `worker.supervisor.ts`, `residency.manager.ts`.
- `undefined` for "not set", never `null`.
- Luxon for time, never `new Date()` or `Date.now()`.
- `packages/core` never imports torch or knows what an engine can do; it reads a capability document.
  `python/rhapsode-worker` never depends on torch either.
- A comment says why, and what it cost to learn. One that restates the code will be asked to go.
- No em dashes in prose.

## Reporting a vulnerability

Not in a public issue. See [SECURITY.md](SECURITY.md).

## Conduct

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Licence

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE) this
repository uses.
