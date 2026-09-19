#!/usr/bin/env node
// First publish and trusted-publisher setup for what rhapsode puts on npm. Run once, by hand.
//
//   node scripts/npm.bootstrap.mjs
//
// The `npm` job in release.yml publishes by trusted publishing and holds no token. npm registers a
// trusted publisher in a package's settings, so a package that has never been published cannot have
// one, and CI cannot make its first version. That version and the trust config are made here, with
// your own npm login. After that every release publishes from CI.
//
// For the first release that means: push the tag, let the `npm` job fail, run this, then re-run the
// failed jobs. The re-run skips what this published and goes on to the GitHub release, which waits for
// it. Publishing from the tag, rather than a placeholder version ahead of it, keeps § 9 true: nothing
// reaches npm at a version the rest of the release does not carry.
//
// Safe to re-run: a package already on npm is not published again, and a trust config that already
// names this repository, workflow and environment is left alone.
//
// Needs npm 11.5.1 or later (`npm trust` arrived there), `npm login` as a member of the npm
// organisation that owns the @rhapsode scope, and 2FA on that account, since `npm trust` asks for a
// one-time password.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** What npm accepts an OIDC publish from. Must match the `npm` job in release.yml. */
const REPOSITORY = 'MaroonedSoftware/rhapsode';
const WORKFLOW = 'release.yml';
const ENVIRONMENT = 'npm';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

/** Runs a command, output shown, failing the script if it fails. */
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit' });

/** Runs a command for its output, or undefined if it fails. */
function capture(command, args, cwd = root) {
    try {
        return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return undefined;
    }
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

const manifest = dir => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

// --- fail fast ---------------------------------------------------------------------------------------

if (capture('npm', ['whoami']) === undefined) fail('Not logged in to npm. Run: npm login');

const npmVersion = capture('npm', ['-v']) ?? '0.0.0';
const [major, minor, patch] = npmVersion.split('.').map(Number);
if (major < 11 || (major === 11 && (minor < 5 || (minor === 5 && patch < 1))))
    fail(`npm ${npmVersion} is too old: 'npm trust' needs 11.5.1 or later. Upgrade with: npm install -g npm@latest`);

// The same list the `npm` job publishes, so a package cannot be trusted here and never published there.
const packages = capture('node', ['scripts/release.mjs', 'list', 'npm'])?.split('\n') ?? fail('release.mjs list npm failed');

// --- per package -------------------------------------------------------------------------------------

for (const dir of packages) {
    const { name, version } = manifest(join(root, dir));

    // 1. The first version, if npm has none. Built from the release tag, in a throwaway worktree, so
    //    what lands on npm is the source that release shipped whatever this checkout holds. main's
    //    manifest carries the last release's number between releases, so it names the newest tag.
    if (capture('npm', ['view', name, 'version']) !== undefined) {
        console.log(`exists:   ${name}`);
    } else {
        const tag = `v${version}`;
        capture('git', ['fetch', '--quiet', 'origin', `refs/tags/${tag}:refs/tags/${tag}`]);
        if (capture('git', ['rev-parse', '-q', '--verify', `${tag}^{commit}`]) === undefined)
            fail(`${name} is not on npm, and there is no ${tag} tag to publish it from. Push a release tag first.`);

        const tree = join(mkdtempSync(join(tmpdir(), 'rhapsode-')), tag);
        run('git', ['worktree', 'add', '--quiet', '--detach', tree, tag]);
        try {
            const tagged = manifest(join(tree, dir));
            // Thrown rather than failed, so the worktree is still removed: process.exit skips `finally`.
            if (tagged.version !== version) throw new Error(`${tag} has ${name} at ${tagged.version}, not ${version}.`);
            if (tagged.private === true) throw new Error(`${name} is private at ${tag}, so it was not released there.`);

            console.log(`building: ${name} ${version} from ${tag}`);
            run('pnpm', ['install', '--frozen-lockfile', '--filter', `${name}...`], tree);
            run('pnpm', ['--filter', name, 'build'], tree);

            // pnpm, because only pnpm rewrites `workspace:` ranges. --no-git-checks because a detached
            // tag checkout is what pnpm's branch check refuses, and the tag is the stronger guarantee.
            // No provenance on this one version: that needs the workflow's identity, which a laptop lacks.
            console.log(`publish:  ${name} ${version} (first publish)`);
            run('pnpm', ['publish', '--access', 'public', '--no-git-checks'], join(tree, dir));
        } finally {
            capture('git', ['worktree', 'remove', '--force', tree]);
        }
    }

    // 2. The trusted publisher. Left alone when one already names this repository, workflow and
    //    environment. Anything else is revoked and replaced, because a stale one would let a
    //    workflow this repository no longer controls publish under the name.
    let configs = [];
    try {
        const data = JSON.parse(capture('npm', ['trust', 'list', name, '--json']) ?? '[]');
        configs = Array.isArray(data) ? data : (data.trustedPublishers ?? data.publishers ?? (data.id ? [data] : []));
    } catch {
        // No config, or output this npm does not produce as JSON: treated as none, and created below.
    }

    // Quoted for the environment, because a bare `npm` turns up in nearly any field of npm's output.
    const text = config => JSON.stringify(config);
    const current = config => text(config).includes(REPOSITORY) && text(config).includes(WORKFLOW) && text(config).includes(`"${ENVIRONMENT}"`);

    if (configs.some(current)) {
        console.log(`trusted:  ${name} (${REPOSITORY} / ${WORKFLOW} / ${ENVIRONMENT})`);
        continue;
    }
    for (const stale of configs.filter(config => config.id !== undefined)) {
        console.log(`revoking: ${name} trust ${stale.id}, which does not name ${REPOSITORY} / ${WORKFLOW} / ${ENVIRONMENT}`);
        run('npm', ['trust', 'revoke', name, `--id=${stale.id}`]);
    }
    console.log(`trusting: ${name} (${REPOSITORY} / ${WORKFLOW} / ${ENVIRONMENT})`);
    run('npm', ['trust', 'github', name, '--repository', REPOSITORY, '--file', WORKFLOW, '--environment', ENVIRONMENT, '--allow-publish', '--yes']);
}

console.log('Done. Re-run the failed jobs of the release workflow, and CI publishes every release from here on.');
