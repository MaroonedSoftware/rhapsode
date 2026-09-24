import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blob, NOTICE, pages, render, rewriteLinks, rewriteTarget } from '../../scripts/docs.sync.mjs';

const root = resolve(import.meta.dirname, '../../../..');

describe('rewriteTarget', () => {
    it('sends a relative link to a file the site does not copy to that file on GitHub', () => {
        expect(rewriteTarget('LICENSE', 'CONTRIBUTING.md', 'develop/contributing.md')).toBe(`${blob}/LICENSE`);
    });

    it('resolves a relative link against the source directory, not the doc one', () => {
        expect(rewriteTarget('../../README.md#licence', 'python/rhapsode-engine-dia/README.md', 'engines/dia.md')).toBe(`${blob}/README.md#licence`);
    });

    it('sends a GitHub link to a copied file to its page on the site, anchor kept', () => {
        expect(rewriteTarget(`${blob}/docs/protocol.md#8-the-python-worker-sdk`, 'python/rhapsode-engine-tone/README.md', 'engines/tone.md')).toBe(
            '../protocol.md#8-the-python-worker-sdk',
        );
    });

    it('sends a relative link to a copied file to its page on the site', () => {
        expect(rewriteTarget('operating.md', 'docs/protocol.md', 'protocol.md')).toBe('operating.md');
        expect(rewriteTarget('../python/rhapsode-engine-dia/README.md', 'docs/operating.md', 'operating.md')).toBe('engines/dia.md');
    });

    it('leaves anchors, absolute URLs and site paths alone', () => {
        expect(rewriteTarget('#settings', 'docs/operating.md', 'operating.md')).toBe('#settings');
        expect(rewriteTarget('https://huggingface.co/hexgrad/Kokoro-82M', 'python/rhapsode-engine-kokoro/README.md', 'engines/kokoro.md')).toBe(
            'https://huggingface.co/hexgrad/Kokoro-82M',
        );
        expect(rewriteTarget(`${blob}/compose.yaml`, 'docs/operating.md', 'operating.md')).toBe(`${blob}/compose.yaml`);
        expect(rewriteTarget('/openapi.yaml', 'docs/operating.md', 'operating.md')).toBe('/openapi.yaml');
    });
});

describe('rewriteLinks', () => {
    it('rewrites links and images outside code fences, and nothing inside one', () => {
        const body = [
            'See [the licence](LICENSE) and ![mark](mark.svg "The mark").',
            '',
            '```md',
            '[not a link](LICENSE)',
            '```',
            '',
            '[after](SECURITY.md)',
        ].join('\n');
        expect(rewriteLinks(body, 'CONTRIBUTING.md', 'develop/contributing.md')).toBe(
            [
                `See [the licence](${blob}/LICENSE) and ![mark](${blob}/mark.svg "The mark").`,
                '',
                '```md',
                '[not a link](LICENSE)',
                '```',
                '',
                `[after](${blob}/SECURITY.md)`,
            ].join('\n'),
        );
    });
});

describe('render', () => {
    const page = { source: 'python/rhapsode-engine-tone/README.md', doc: 'engines/tone.md', label: 'Tone' };

    it('puts the front matter first and the notice after the H1, so the H1 stays the title', () => {
        const lines = render('# rhapsode-engine-tone\n\nA tone.\n', page).split('\n');
        expect(lines.slice(0, 5)).toEqual([
            '---',
            'sidebar_label: Tone',
            `custom_edit_url: ${blob}/python/rhapsode-engine-tone/README.md`,
            '---',
            '# rhapsode-engine-tone',
        ]);
        expect(lines[5]).toContain(NOTICE);
        expect(lines.slice(6)).toEqual(['', 'A tone.', '']);
    });

    it('still carries the notice for a source with no H1', () => {
        expect(render('A tone.\n', page)).toContain(NOTICE);
    });
});

describe('pages', () => {
    it('names sources that exist', () => {
        expect(pages.filter(page => !existsSync(resolve(root, page.source))).map(page => page.source)).toEqual([]);
    });

    it('gives every source one doc', () => {
        expect(new Set(pages.map(page => page.doc)).size).toBe(pages.length);
    });
});
