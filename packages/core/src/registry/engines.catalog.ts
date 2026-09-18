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
    kokoro: {
        displayName: 'Kokoro',
        module: 'rhapsode_engine_kokoro',
        package: 'rhapsode-engine-kokoro',
        // fp16, because it was the fastest of the three on the CPU it was measured on (9.9x realtime
        // against fp32's 8.3x and int8's 2.5x) and half fp32's download.
        defaultVariant: 'fp16',
        // 3.11 for the worker SDK. Below 3.14 for kokoro-onnx, whose 0.6 declares it; on 3.14 pip
        // installs 0.4.7 instead, without a word, and the adapter was written against 0.6.
        python: { from: '3.11', below: '3.14' },
        license: {
            // What the worker process runs, not what the adapter package is. protocol.md § 4.
            code: 'GPL-3.0-or-later',
            weights: 'Apache-2.0',
            weightsCommercialUse: true,
            notes: 'GPL through phonemizer and eSpeak NG, which kokoro-onnx (MIT) phonemizes with. Weights: hexgrad/Kokoro-82M, Apache-2.0.',
        },
    },
    orpheus: {
        displayName: 'Orpheus',
        module: 'rhapsode_engine_orpheus',
        package: 'rhapsode-engine-orpheus',
        // q8 rather than q4: the two are 1.4 GB apart, and what the coarser quantisation costs in the
        // reading has not been heard yet, so the default is the build nearer Canopy's own weights.
        defaultVariant: 'q8',
        license: {
            code: 'Apache-2.0',
            weights: 'Apache-2.0',
            weightsCommercialUse: true,
            // Canopy's finetune is a Llama 3.2 derivative, and the builds are community GGUF
            // conversions of it, not Canopy's own files. Both are worth knowing before install.
            notes: 'https://huggingface.co/canopylabs/orpheus-3b-0.1-ft, a finetune of Llama 3.2 3B, run from unsloth GGUF conversions',
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
