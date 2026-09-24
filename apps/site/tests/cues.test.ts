import { describe, expect, it } from 'vitest';
import { flatten, LINE, render, TARGETS, type Target } from '../src/cues';

const target = (id: string): Target => {
    const found = TARGETS.find(candidate => candidate.id === id);
    if (!found) throw new Error(`no target ${id}`);
    return found;
};

describe('render', () => {
    it('translates every claimed cue into the engine tag', () => {
        const rendering = render(LINE, target('dia'));
        expect(flatten(rendering)).toBe('(clears throat) Right, that was The Verve Pipe. (laughs) Nobody warned me about that intro.');
        expect(rendering.stripped).toEqual([]);
    });

    it('strips an unclaimed cue and closes the space it leaves, at the start and mid-line', () => {
        const rendering = render(LINE, target('orpheus'));
        expect(flatten(rendering)).toBe('Right, that was The Verve Pipe. <laugh> Nobody warned me about that intro.');
        expect(rendering.stripped).toEqual(['clear throat']);
    });

    it('hands a variant that claims no cues the words alone', () => {
        const rendering = render(LINE, target('kokoro'));
        expect(flatten(rendering)).toBe('Right, that was The Verve Pipe. Nobody warned me about that intro.');
        expect(rendering.stripped).toEqual(['clear throat', 'laugh']);
    });

    it('marks tags apart from words', () => {
        expect(render('Well [sigh] fine.', { id: 'x', label: 'x', tags: { sigh: '<sigh>' } }).pieces).toEqual([
            { kind: 'text', text: 'Well ' },
            { kind: 'tag', text: '<sigh>', cue: 'sigh' },
            { kind: 'text', text: ' fine.' },
        ]);
    });

    it('leaves brackets that are not a standard cue as words', () => {
        expect(flatten(render('A [yawn] B', target('kokoro')))).toBe('A [yawn] B');
    });
});
