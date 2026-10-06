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
    /**
     * Python distributions the adapter depends on that no index has, installed in the same resolve
     * from beside it. An upstream whose code has no packaging of its own is copied into one of these,
     * because pip cannot install a repository with no pyproject, and resolving it as a name would go
     * to an index that does not have it. protocol.md § 10.
     */
    companions?: string[];
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
    breeze: {
        displayName: 'Breeze TTS 2',
        module: 'rhapsode_engine_breeze',
        package: 'rhapsode-engine-breeze',
        // Upstream's inference code has no pyproject, so it is copied at one commit into a package of
        // its own and installed beside the adapter. protocol.md § 10.
        companions: ['rhapsode-vendor-breeze'],
        // The one build, named for the release.
        defaultVariant: '2',
        // 3.11 for the worker SDK. Below 3.15 for onnxruntime, which qwen-tts depends on unpinned and
        // whose 1.30 has wheels for 3.11 to 3.14; past that pip would quietly resolve an older one.
        // Measured on 3.12, on an RTX 4070 Ti SUPER.
        python: { from: '3.11', below: '3.15' },
        license: {
            code: 'Apache-2.0',
            weights: 'BreezeBlue-Research-Non-Commercial',
            weightsCommercialUse: false,
            // The licence reaches past the weights, to what is made with them on your own hardware,
            // and the card is NVIDIA-only. Both decide an install, so both are read before one.
            notes: 'https://huggingface.co/BreezeBlue/Breeze-TTS-2/blob/main/LICENSE. Research and non-commercial use only, including derivative models and audio generated on your own hardware. Needs an NVIDIA card with CUDA and about 8 GB of VRAM.',
        },
    },
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
    fish: {
        displayName: 'Fish Audio S2 Pro',
        module: 'rhapsode_engine_fish',
        package: 'rhapsode-engine-fish',
        // The one build, named as upstream names it.
        defaultVariant: 's2-pro',
        // 3.11 for the worker SDK. Below 3.14 for torch 2.8.0, which upstream pins and which has
        // wheels for nothing newer; on 3.14 pip would find no torch at that version and fail.
        python: { from: '3.11', below: '3.14' },
        license: {
            // The code licence is what the worker runs, and the worker runs fish-speech, which the
            // adapter fetches from upstream and which is under the same research licence as the
            // weights. A scanner reading the adapter's MIT would be wrong about both. § 4.
            code: 'Fish-Audio-Research-License',
            weights: 'Fish-Audio-Research-License',
            weightsCommercialUse: false,
            notes: 'https://huggingface.co/fishaudio/s2-pro/blob/main/LICENSE.md. Research and non-commercial use only; commercial use needs a licence from Fish Audio. Distributing it, or a product that uses it, requires the agreement, a notice, and "Built with Fish Audio". The worker runs fish-speech, downloaded from upstream at a pinned commit. About 12.3 GiB of VRAM while speaking.',
        },
    },
    dia: {
        displayName: 'Dia',
        module: 'rhapsode_engine_dia',
        package: 'rhapsode-engine-dia',
        // The one build, named for its size so that Dia2's can sit beside it.
        defaultVariant: '1.6b',
        license: {
            code: 'Apache-2.0',
            weights: 'Apache-2.0',
            weightsCommercialUse: true,
            // Upstream's README forbids imitating a real person without consent, and deception, in a
            // section it calls a disclaimer rather than a licence term. Here it is read before install.
            notes: 'https://huggingface.co/nari-labs/Dia-1.6B-0626, run through transformers. Upstream asks that it not be used to imitate a real person without consent or to deceive.',
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
