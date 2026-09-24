/**
 * The engines the front page lists, in the order it lists them: the one to install first, then by
 * what each adds. The licences restate `packages/core/src/registry/engines.catalog.ts`, and
 * `tests/engines.test.ts` fails if they drift from it or if the catalog gains or loses an engine.
 * The rest is from each engine's README, which the site also publishes.
 */
export interface Engine {
    id: string;
    name: string;
    /** One sentence: what this engine is for. */
    summary: string;
    /** Where it is meant to run. */
    runsOn: string;
    /** The default variant, and what its weights cost to download. */
    weights: string;
    /** How many of the eight standard cues its default variant performs (protocol.md § 5). */
    cues: number;
    /** How it makes a voice beyond the ones it ships with. */
    voices: string;
    license: { code: string; weights: string };
}

export const ENGINES: Engine[] = [
    {
        id: 'kokoro',
        name: 'Kokoro',
        summary: 'An ONNX engine with no torch: the one to install first, on whatever machine you have.',
        runsOn: 'CPU',
        weights: 'fp16, 205 MB',
        cues: 0,
        voices: 'Blends, and style vectors',
        license: { code: 'GPL-3.0-or-later', weights: 'Apache-2.0' },
    },
    {
        id: 'chatterbox',
        name: 'Chatterbox',
        summary: 'Clones a voice from a short clip, and performs cues or honours dials depending on the build.',
        runsOn: 'GPU',
        weights: 'turbo, 3.8 GB',
        cues: 8,
        voices: 'Clones from a clip',
        license: { code: 'MIT', weights: 'MIT' },
    },
    {
        id: 'orpheus',
        name: 'Orpheus',
        summary: 'A Llama that speaks in audio codes, and streams while it is still generating.',
        runsOn: 'GPU',
        weights: 'q8, 3.5 GB, or full on Linux',
        cues: 7,
        voices: 'Its own eight',
        license: { code: 'Apache-2.0', weights: 'Apache-2.0' },
    },
    {
        id: 'dia',
        name: 'Dia',
        summary: 'Two speakers in one take, cloned from a clip and the words spoken in it.',
        runsOn: 'GPU',
        weights: '1.6b, 6.7 GB',
        cues: 8,
        voices: 'Clones from a clip and its transcript',
        license: { code: 'Apache-2.0', weights: 'Apache-2.0' },
    },
    {
        id: 'tone',
        name: 'Tone',
        summary: 'No weights and no speech: a sine wave that proves the protocol in CI on every commit.',
        runsOn: 'Anywhere',
        weights: 'None',
        cues: 2,
        voices: 'Clones, to test the path',
        license: { code: 'MIT', weights: 'MIT' },
    },
];
