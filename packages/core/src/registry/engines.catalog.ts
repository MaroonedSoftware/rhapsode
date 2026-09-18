import type { EngineEntry } from './engine.registry.js';

/**
 * One engine that exists. `package` is the Python distribution an install puts in the engine's
 * virtualenv: a name rather than a path, so the catalog stays the same on every machine and the
 * installer decides where to find it. protocol.md § 10.
 */
export type CatalogRecord = Pick<EngineEntry, 'displayName' | 'license' | 'module' | 'defaultVariant'> & {
    module: string;
    package: string;
    /**
     * The Python versions the engine's own dependencies install on, when that is narrower than the
     * SDK's. Without it pip quietly resolves whatever old release still claims to support the
     * interpreter it was given, which is a different engine from the one the adapter was written
     * against. protocol.md § 10.
     */
    python?: PythonRange;
};

/** At least `from`, and below `below`. Both `major.minor`. */
export interface PythonRange {
    from: string;
    below: string;
}

/**
 * What exists, as distinct from what this box has.
 *
 * It names no paths and no virtualenvs, so it is the same on every machine. It carries both
 * licences because § 4's promise is that the weights licence is visible **before** install, which
 * is the only point at which it can change anybody's decision. A licence scanner reads the package
 * and reports the code licence, and is wrong in the way that matters.
 */
export const CATALOG: Record<string, CatalogRecord> = {
    chatterbox: {
        displayName: 'Chatterbox',
        module: 'rhapsode_engine_chatterbox',
        package: 'rhapsode-engine-chatterbox',
        // turbo, because it is the build that performs the cues and cues are the part a client can
        // use without knowing anything about this engine. An operator who wants the dials asks for
        // `original` by name, which is a choice rather than a default.
        defaultVariant: 'turbo',
        license: {
            code: 'MIT',
            weights: 'MIT',
            weightsCommercialUse: true,
            notes: 'https://github.com/resemble-ai/chatterbox',
        },
    },
    tone: {
        displayName: 'Tone',
        module: 'rhapsode_engine_tone',
        package: 'rhapsode-engine-tone',
        defaultVariant: 'plain',
        license: {
            code: 'MIT',
            weights: 'MIT',
            weightsCommercialUse: true,
            notes: 'No weights: it is arithmetic.',
        },
    },
};
