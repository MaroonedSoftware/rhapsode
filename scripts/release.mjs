#!/usr/bin/env node
// One version for every released package, npm, PyPI and the image alike. protocol.md § 9.
//
//   node scripts/release.mjs version 0.1.0   set it everywhere and fold .changeset/ into CHANGELOG.md
//   node scripts/release.mjs check v0.1.0    fail unless every versioned package is at that version
//   node scripts/release.mjs notes 0.1.0     print that version's CHANGELOG section
//   node scripts/release.mjs list npm|python  the published package directories, in publishing order
//   node scripts/release.mjs current         the version every versioned package is at now
//   node scripts/release.mjs pending         how many changesets are waiting for a release
//   node scripts/release.mjs next [x.y.z]    the version to propose: that one if it is newer, or the next patch
//
// This rather than `changeset version`, because changesets knows only the pnpm workspace. Half of
// what ships is Python, a changeset cannot name a Python package, and 15 of the first 37 had an
// empty header for exactly that reason: `changeset version` would have bumped nothing for them. The
// changesets stay what a change is described in; this decides the number.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Carry the release version. The core is not published, but it still has to be at the release's
 * number: it reads its own `package.json` to pin the engines it installs (§ 9), so a core left at
 * 0.0.0 inside a 0.3.0 image would ask PyPI for `rhapsode-engine-kokoro==0.0.0`. The remaining
 * workspace packages (cli, web, eslint and tsconfig) keep 0.0.0.
 */
const VERSIONED = ['packages/contract', 'packages/sdk', 'packages/core', 'apps/server'];

/**
 * Published to npm. Only the client SDK: the server ships as a Docker image, and nothing outside this
 * repository needs the core or the contract from a registry. The SDK depends on neither at run time.
 */
const NPM = ['packages/sdk'];

/**
 * Carry the release version: the SDK first, the conformance suite, and every engine the catalog
 * installs. Versioned although none is published yet, so that publishing one later is a line in
 * PYPI below and not a renumbering, and every engine's `rhapsode-worker` pin stays exact (§ 9).
 */
const PYTHON = [
    'python/rhapsode-worker',
    'python/conformance',
    'python/rhapsode-engine-chatterbox',
    'python/rhapsode-engine-kokoro',
    'python/rhapsode-engine-orpheus',
    'python/rhapsode-engine-tone',
];

/**
 * Published to PyPI, in publishing order, the SDK first. None yet: every way to run the core installs
 * engines from the sources it ships with (`install.sourceDir`), so nothing reads the index. The first
 * package here needs a pending trusted publisher on pypi.org, and the `pypi` job back in release.yml.
 */
const PYPI = [];

const CHANGESETS = join(root, '.changeset');
const CHANGELOG = join(root, 'CHANGELOG.md');
const SEMVER = /^\d+\.\d+\.\d+$/;
const PYPROJECT_VERSION = /^version = "([^"]+)"$/m;
// An engine's pin on the SDK. protocol.md § 9: its own version, exactly.
const WORKER_PIN = /"rhapsode-worker==[^"]+"/g;

const read = path => readFileSync(join(root, path), 'utf8');
const write = (path, text) => writeFileSync(join(root, path), text);

function fail(message) {
    console.error(message);
    process.exit(1);
}

/** Every versioned package and the version it is at now. */
function current() {
    return [
        ...VERSIONED.map(dir => ({ where: `${dir}/package.json`, version: JSON.parse(read(`${dir}/package.json`)).version })),
        ...PYTHON.flatMap(dir => {
            const text = read(`${dir}/pyproject.toml`);
            const pins = [...text.matchAll(WORKER_PIN)].map(match => ({
                where: `${dir}/pyproject.toml, its rhapsode-worker pin`,
                version: match[0].slice(18, -1),
            }));
            return [{ where: `${dir}/pyproject.toml`, version: PYPROJECT_VERSION.exec(text)?.[1] }, ...pins];
        }),
    ];
}

function setVersions(version) {
    for (const dir of VERSIONED) {
        const path = `${dir}/package.json`;
        // Replaced in place rather than re-serialised, so the file's own layout survives.
        write(path, read(path).replace(/^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`));
    }
    for (const dir of PYTHON) {
        const path = `${dir}/pyproject.toml`;
        write(path, read(path).replace(PYPROJECT_VERSION, `version = "${version}"`).replace(WORKER_PIN, `"rhapsode-worker==${version}"`));
    }
    for (const [path, pattern] of OPENAPI_VERSION) {
        const text = read(path);
        if (!pattern.test(text)) fail(`${path} has no info.version where release.mjs expects one`);
        write(path, text.replace(pattern, `$1${version}$2`));
    }
}

/**
 * Where the OpenAPI documents carry the core's version as `info.version` (§ 9). Left at the old
 * number, the release commit would fail `codegen:check` on a tree nobody edited by hand.
 *
 * Replaced as text rather than by rerunning scripts/openapi.document.mjs, which parses YAML: the
 * release-pr job installs no dependencies, and a `yaml` import there fails every release pull request.
 * The text is what that script writes, so `codegen:check` finds the two agree.
 */
const OPENAPI_VERSION = [
    ['docs/openapi.yaml', /^(info:\n(?: {4}.*\n)*? {4}version: ).*()$/m],
    ['docs/openapi.worker.yaml', /^(info:\n(?: {4}.*\n)*? {4}version: ).*()$/m],
    ['packages/contract/src/generated/openapi.document.ts', /("info": \{\n\s*"title": "[^"]*",\n\s*"version": ")[^"]*(")/],
];

/** A changeset's body without its header, and when it was first committed, for ordering. */
function changesets() {
    const files = readdirSync(CHANGESETS).filter(name => name.endsWith('.md') && name !== 'README.md');
    return files
        .map(name => {
            const path = join(CHANGESETS, name);
            const body = readFileSync(path, 'utf8')
                .replace(/^---\n(?:[\s\S]*?\n)?---\n/, '')
                .trim();
            const added = execFileSync('git', ['log', '--diff-filter=A', '--format=%ct', '--', path], { cwd: root, encoding: 'utf8' })
                .trim()
                .split('\n')
                .pop();
            // Not yet committed sorts last, which is where the newest change belongs anyway.
            return { path, body, added: added === '' || added === undefined ? Number.MAX_SAFE_INTEGER : Number(added) };
        })
        .filter(entry => entry.body !== '')
        .sort((a, b) => a.added - b.added || a.path.localeCompare(b.path));
}

function section(version, entries) {
    const items = entries.map(entry => `- ${entry.body.replace(/\n/g, '\n  ')}`).join('\n');
    return `## ${version}\n\n${items}\n`;
}

function commandVersion(version) {
    if (!SEMVER.test(version ?? '')) fail(`usage: release.mjs version <major.minor.patch>, not "${version ?? ''}"`);

    const entries = changesets();
    if (entries.length === 0) fail('there are no changesets, so there is nothing to release');

    const stale = [...new Set(current().map(entry => entry.version))];
    if (stale.includes(version)) fail(`something is already at ${version}; a release moves every package to a new number`);

    setVersions(version);

    const heading = '# Changelog\n\nEvery package releases at one version. protocol.md § 9.\n';
    const previous = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, 'utf8').replace(heading, '').trim() : '';
    writeFileSync(CHANGELOG, `${heading}\n${section(version, entries)}${previous === '' ? '' : `\n${previous}\n`}`);
    for (const entry of entries) rmSync(entry.path);

    console.log(
        `${version}: ${VERSIONED.length} workspace and ${PYTHON.length} Python packages, ${entries.length} changesets folded into CHANGELOG.md.`,
    );
    console.log(`Next: commit, then tag v${version} and push the tag, which is what publishes.`);
}

/** The one version everything is at, or a failure naming what disagrees. */
function commandCurrent() {
    const versions = [...new Set(current().map(entry => entry.version))];
    if (versions.length !== 1) fail(`the versioned packages disagree: ${versions.join(', ')}`);
    console.log(versions[0]);
}

/** Numeric, part by part, so that 0.1.10 comes after 0.1.9. */
function newer(a, b) {
    const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
    const i = x.findIndex((part, k) => part !== y[k]);
    return i !== -1 && x[i] > y[i];
}

/**
 * What the release pull request proposes. A version it already proposed is kept while it is still
 * ahead of the one released, so that rebuilding the pull request cannot turn a minor someone asked
 * for back into a patch. Anything else is the next patch.
 */
function commandNext(proposed) {
    const versions = [...new Set(current().map(entry => entry.version))];
    if (versions.length !== 1) fail(`the versioned packages disagree: ${versions.join(', ')}`);
    if (proposed !== undefined && SEMVER.test(proposed) && newer(proposed, versions[0])) {
        console.log(proposed);
        return;
    }
    const [major, minor, patch] = versions[0].split('.').map(Number);
    console.log(`${major}.${minor}.${patch + 1}`);
}

/**
 * npm checks a provenance statement against the package's own `repository.url` and refuses the
 * upload when they differ. The SDK had none, and v0.1.2 failed at the npm job with "repository.url
 * is \"\"", after the build and the image had already run. Checked here, it fails in the first job.
 */
const REPOSITORY_URL = /^(git\+)?https:\/\/github\.com\/MaroonedSoftware\/rhapsode(\.git)?$/;

function commandCheck(tag) {
    const version = (tag ?? '').replace(/^v/, '');
    if (!SEMVER.test(version)) fail(`usage: release.mjs check v<major.minor.patch>, not "${tag ?? ''}"`);

    const unlinked = NPM.filter(dir => !REPOSITORY_URL.test(JSON.parse(read(`${dir}/package.json`)).repository?.url ?? ''));
    if (unlinked.length > 0)
        fail(`npm refuses provenance without repository.url naming this repository:\n${unlinked.map(dir => `  ${dir}/package.json`).join('\n')}`);

    const wrong = current().filter(entry => entry.version !== version);
    if (wrong.length > 0)
        fail(`${tag} does not match what would be published:\n${wrong.map(entry => `  ${entry.where} is ${entry.version}`).join('\n')}`);
    console.log(`every versioned package is at ${version}`);
}

function commandNotes(version) {
    const text = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, 'utf8') : '';
    const start = text.indexOf(`\n## ${version}\n`);
    if (start === -1) fail(`CHANGELOG.md has no section for ${version}`);
    const rest = text.slice(start + 1);
    const end = rest.indexOf('\n## ', 1);
    process.stdout.write(`${(end === -1 ? rest : rest.slice(0, end)).replace(/^## .*\n\n/, '').trim()}\n`);
}

const [command, argument] = process.argv.slice(2);
if (command === 'version') commandVersion(argument);
else if (command === 'check') commandCheck(argument);
else if (command === 'notes') commandNotes(argument?.replace(/^v/, ''));
else if (command === 'current') commandCurrent();
else if (command === 'pending') console.log(changesets().length);
else if (command === 'next') commandNext(argument);
else if (command === 'list' && (argument === 'npm' || argument === 'python')) console.log((argument === 'npm' ? NPM : PYPI).join('\n'));
else fail('usage: release.mjs version <x.y.z> | check <vX.Y.Z> | notes <x.y.z> | list npm|python | current | pending | next [x.y.z]');
