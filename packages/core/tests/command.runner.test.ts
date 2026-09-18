import { describe, expect, it } from 'vitest';

import { failureReason, spawnRunner } from '../src/install/command.runner.js';

/**
 * What pip printed when the Orpheus install failed in the server image on 2026-09-18, from the job's
 * event feed, with the build directory names as they were. The job's error was the last line.
 */
const NO_COMPILER = [
    'Building wheels for collected packages: rhapsode-worker, rhapsode-engine-orpheus, llama-cpp-python',
    '  Building wheel for llama-cpp-python (pyproject.toml): started',
    "  Building wheel for llama-cpp-python (pyproject.toml): finished with status 'error'",
    '  error: subprocess-exited-with-error',
    '  ',
    '  × Building wheel for llama-cpp-python (pyproject.toml) did not run successfully.',
    '  │ exit code: 1',
    '  ╰─> [16 lines of output]',
    '      *** scikit-build-core 1.0.3 using CMake 4.4.3 (wheel)',
    '      *** Configuring CMake...',
    '      loading initial cache file /tmp/tmp0b95oshp/build/CMakeInit.txt',
    '      CMake Error at /tmp/pip-build-env-osrkj_gr/normal/lib/python3.12/site-packages/cmake/data/share/cmake-4.4/Modules/CMakeDetermineCCompiler.cmake:48 (message):',
    '        Could not find the compiler specified in the environment variable CC:',
    '      ',
    '        cc.',
    '      Call Stack (most recent call first):',
    '        CMakeLists.txt:3 (project)',
    '      ',
    '      ',
    '      CMake Error: CMAKE_C_COMPILER not set, after EnableLanguage',
    '      CMake Error: CMAKE_CXX_COMPILER not set, after EnableLanguage',
    '      -- Configuring incomplete, errors occurred!',
    '      ',
    '      *** CMake configuration failed',
    '      [end of output]',
    '  ',
    '  note: This error originates from a subprocess, and is likely not a problem with pip.',
    '  ERROR: Failed building wheel for llama-cpp-python',
    'Successfully built rhapsode-worker rhapsode-engine-orpheus',
    'Failed to build llama-cpp-python',
    'error: failed-wheel-build-for-install',
    '',
    '× Failed to build installable wheels for some pyproject.toml based projects',
    '╰─> llama-cpp-python',
];

const NO_SUCH_PACKAGE = [
    'Processing /app/python/rhapsode-worker',
    '  Installing build dependencies: started',
    "  Installing build dependencies: finished with status 'done'",
    'ERROR: Could not find a version that satisfies the requirement rhapsode-engine-nonesuch (from versions: none)',
    'ERROR: No matching distribution found for rhapsode-engine-nonesuch',
];

/** A network that intercepts TLS, as this repository's own sandbox does, before pip gives up. */
const CERTIFICATE = [
    "WARNING: Retrying (Retry(total=4, connect=None, read=None, redirect=None, status=None)) after connection broken by 'SSLError(SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1010)'))': /simple/hatchling/",
    "WARNING: Retrying (Retry(total=0, connect=None, read=None, redirect=None, status=None)) after connection broken by 'SSLError(SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1010)'))': /simple/hatchling/",
    "Could not fetch URL https://pypi.org/simple/hatchling/: There was a problem confirming the ssl certificate: HTTPSConnectionPool(host='pypi.org', port=443): Max retries exceeded with url: /simple/hatchling/ (Caused by SSLError(SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1010)'))) - skipping",
    'ERROR: Could not find a version that satisfies the requirement hatchling (from versions: none)',
    'ERROR: No matching distribution found for hatchling',
];

describe('failureReason', () => {
    it('names the compiler that is missing, and the package whose build needed it, not pip’s footer', () => {
        expect(failureReason(NO_COMPILER)).toBe('CMake Error: CMAKE_CXX_COMPILER not set, after EnableLanguage (building llama-cpp-python)');
    });

    it('keeps "No matching distribution", which was already the right line', () => {
        expect(failureReason(NO_SUCH_PACKAGE)).toBe('ERROR: No matching distribution found for rhapsode-engine-nonesuch');
    });

    it('says the certificate failed, not that the package does not exist', () => {
        const reason = failureReason(CERTIFICATE);
        expect(reason).toMatch(/^Could not fetch URL https:\/\/pypi\.org\/simple\/hatchling\/: There was a problem confirming the ssl certificate/);
        expect(reason).not.toMatch(/No matching distribution/);
    });

    it('falls back to the last line when nothing says error', () => {
        expect(failureReason(['Collecting numpy', 'Killed'])).toBe('Killed');
    });

    it('falls back to pip’s own words when that is all there is', () => {
        expect(failureReason(['error: subprocess-exited-with-error', '╰─> llama-cpp-python'])).toBe('╰─> llama-cpp-python');
    });

    it('has nothing to say about a command that printed nothing', () => {
        expect(failureReason([])).toBeUndefined();
        expect(failureReason(['', '   '])).toBeUndefined();
    });
});

describe('spawnRunner', () => {
    it('fails with the reason, not the last line', async () => {
        const script = `for (const line of ${JSON.stringify(NO_COMPILER)}) console.error(line); process.exit(1);`;
        const printed: string[] = [];
        const run = spawnRunner(
            { step: 'packages', command: process.execPath, args: ['-e', script] },
            line => printed.push(line),
            new AbortController().signal,
        );

        await expect(run).rejects.toThrow(/exited 1: CMake Error: CMAKE_CXX_COMPILER not set, after EnableLanguage \(building llama-cpp-python\)$/);
        // Every line still reaches the job's feed.
        expect(printed).toHaveLength(NO_COMPILER.length);
    });
});
