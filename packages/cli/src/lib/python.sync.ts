import type { CliContext } from '@maroonedsoftware/johnny5';

/** The hosts pip talks to, which a TLS-intercepting proxy breaks certificate verification for. */
export const PYPI_HOSTS = 'pypi.org,files.pythonhosted.org';

/**
 * `pnpm python:sync`, the one way the dev venv gets built, so the CLI and CI cannot disagree about
 * what is in it. `trustPypi` sets `RHAPSODE_PIP_TRUSTED_HOSTS` for this one run and never writes it
 * anywhere: weakening certificate verification is a local, per-occasion decision.
 */
export const pythonSync = (ctx: CliContext, options: { trustPypi?: boolean } = {}): Promise<number> =>
    ctx.shell.runStreaming('node', ['scripts/python.mjs', 'sync'], {
        cwd: ctx.paths.repoRoot,
        env: { ...process.env, ...(options.trustPypi ? { RHAPSODE_PIP_TRUSTED_HOSTS: PYPI_HOSTS } : {}) },
    });
