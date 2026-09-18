import type { EngineEntry } from './engine.registry.js';

/**
 * What exists, as distinct from what this box has.
 *
 * It names no paths and no virtualenvs, so it is the same on every machine. It carries both
 * licences because § 4's promise is that the weights licence is visible **before** install, which
 * is the only point at which it can change anybody's decision. A licence scanner reads the package
 * and reports the code licence, and is wrong in the way that matters.
 */
export const CATALOG: Record<string, Pick<EngineEntry, 'displayName' | 'license' | 'module' | 'defaultVariant'>> = {
    chatterbox: {
        displayName: 'Chatterbox',
        module: 'rhapsode_engine_chatterbox',
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
        defaultVariant: 'plain',
        license: {
            code: 'MIT',
            weights: 'MIT',
            weightsCommercialUse: true,
            notes: 'No weights: it is arithmetic.',
        },
    },
};
