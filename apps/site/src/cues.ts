/**
 * The front page's demonstration of protocol.md § 5: one line, written once in the standard
 * vocabulary, and what each engine's model is handed. The core strips every cue the loaded variant
 * does not claim, closing the space it leaves; the adapter translates the rest into its engine's
 * own tag. The tags are the adapters' own (`builds.py` in each engine package).
 */

/** The eight standard cues. */
export const CUES = ['laugh', 'chuckle', 'sigh', 'gasp', 'cough', 'clear throat', 'sniff', 'groan'] as const;
export type Cue = (typeof CUES)[number];

export interface Target {
    id: string;
    /** The engine and the build, as a person would say it. */
    label: string;
    /** What each claimed cue becomes. A cue with no entry is not claimed, and the core strips it. */
    tags: Partial<Record<Cue, string>>;
}

/** The line § 6 uses as its example, with one cue Orpheus cannot perform. */
export const LINE = '[clear throat] Right, that was The Verve Pipe. [laugh] Nobody warned me about that intro.';

export const TARGETS: Target[] = [
    { id: 'chatterbox-turbo', label: 'Chatterbox turbo', tags: { 'clear throat': '[clear throat]', laugh: '[laugh]' } },
    { id: 'orpheus', label: 'Orpheus', tags: { laugh: '<laugh>' } },
    { id: 'dia', label: 'Dia', tags: { 'clear throat': '(clears throat)', laugh: '(laughs)' } },
    { id: 'chatterbox-original', label: 'Chatterbox original', tags: {} },
    { id: 'kokoro', label: 'Kokoro', tags: {} },
];

/** One piece of what the model is handed: words, or an engine's tag for a cue. */
export type Piece = { kind: 'text'; text: string } | { kind: 'tag'; text: string; cue: Cue };

export interface Rendering {
    pieces: Piece[];
    /** The cues the core removed, in the order they appeared. */
    stripped: Cue[];
}

const CUE = /\[([a-z ]+)\]/g;

const isCue = (word: string): word is Cue => (CUES as readonly string[]).includes(word);

/** What `target`'s model is handed for `line`. */
export function render(line: string, target: Target): Rendering {
    const pieces: Piece[] = [];
    const stripped: Cue[] = [];
    let text = '';
    let last = 0;
    for (const match of line.matchAll(CUE)) {
        const word = match[1] ?? '';
        text += line.slice(last, match.index);
        last = match.index + match[0].length;
        if (!isCue(word)) {
            text += match[0];
            continue;
        }
        const tag = target.tags[word];
        if (tag === undefined) {
            stripped.push(word);
            // A removal closes the space it leaves behind (§ 5), so drop one side of it.
            if (text === '' || text.endsWith(' ')) {
                while (line[last] === ' ') last += 1;
            }
            continue;
        }
        if (text) pieces.push({ kind: 'text', text });
        text = '';
        pieces.push({ kind: 'tag', text: tag, cue: word });
    }
    text += line.slice(last);
    if (text) pieces.push({ kind: 'text', text });
    return { pieces, stripped };
}

/** The rendering as the single string the model reads. */
export const flatten = (rendering: Rendering) => rendering.pieces.map(piece => piece.text).join('');
