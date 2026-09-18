#!/usr/bin/env node
// One version for every published package, npm and PyPI alike. protocol.md § 9.
//
//   node scripts/release.mjs version 0.1.0   set it everywhere and fold .changeset/ into CHANGELOG.md
//   node scripts/release.mjs check v0.1.0    fail unless every published package is at that version
//   node scripts/release.mjs notes 0.1.0     print that version's CHANGELOG section
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

/** Published to npm. The private workspace packages (cli, web, eslint and tsconfig) keep 0.0.0. */
const NPM = ['packages/contract', 'packages/core', 'packages/sdk', 'apps/server'];

/** Published to PyPI: the SDK, the conformance suite, and every engine the catalog installs by name. */
const PYTHON = [
    'python/rhapsode-worker',
    'python/conformance',
    'python/rhapsode-engine-chatterbox',
    'python/rhapsode-engine-kokoro',
    'python/rhapsode-engine-orpheus',
    'python/rhapsode-engine-tone',
];

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

/** Every published package and the version it is at now. */
function current() {
    return [
        ...NPM.map(dir => ({ where: `${dir}/package.json`, version: JSON.parse(read(`${dir}/package.json`)).version })),
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
    for (const dir of NPM) {
        const path = `${dir}/package.json`;
        // Replaced in place rather than re-serialised, so the file's own layout survives.
        write(path, read(path).replace(/^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`));
    }
    for (const dir of PYTHON) {
        const path = `${dir}/pyproject.toml`;
        write(path, read(path).replace(PYPROJECT_VERSION, `version = "${version}"`).replace(WORKER_PIN, `"rhapsode-worker==${version}"`));
    }
}

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

    console.log(`${version}: ${NPM.length} npm and ${PYTHON.length} Python packages, ${entries.length} changesets folded into CHANGELOG.md.`);
    console.log(`Next: commit, then tag v${version} and push the tag, which is what publishes.`);
}

function commandCheck(tag) {
    const version = (tag ?? '').replace(/^v/, '');
    if (!SEMVER.test(version)) fail(`usage: release.mjs check v<major.minor.patch>, not "${tag ?? ''}"`);

    const wrong = current().filter(entry => entry.version !== version);
    if (wrong.length > 0)
        fail(`${tag} does not match what would be published:\n${wrong.map(entry => `  ${entry.where} is ${entry.version}`).join('\n')}`);
    console.log(`every published package is at ${version}`);
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
else fail('usage: release.mjs version <x.y.z> | check <vX.Y.Z> | notes <x.y.z>');
