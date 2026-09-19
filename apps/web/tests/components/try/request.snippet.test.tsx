import { execFileSync } from 'node:child_process';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { EngineSpeakRequest } from '@maroonedsoftware/rhapsode-sdk';

import { RequestSnippet, snippet } from '../../../src/components/try/request.snippet';
import { render, screen, setupUser } from '../../utils/render';

// The snippet links to the API reference, and these tests render it with no router around it.
vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
}));

const body: EngineSpeakRequest = { engine: 'chatterbox', text: "It's a line.", variant: 'turbo', format: 'wav', stream: false };

describe('snippet', () => {
    it('sends curl through the address the page reaches the core at', () => {
        const curl = snippet('curl', body, 'http://box:8081');
        expect(curl).toContain('curl -X POST http://box:8081/api/speak');
        expect(curl).toContain('-o line.wav');
    });

    it('quotes a line with an apostrophe so the shell hands the core the same JSON', () => {
        // A single quote ends a single-quoted shell string, and "It's" is the first thing anyone types.
        const curl = snippet('curl', body, 'http://box:8081');
        const quoted = curl
            .split('\n')[2]!
            .replace(/^\s*-d /, '')
            .replace(/ \\$/, '');
        const heard = execFileSync('sh', ['-c', `printf '%s' ${quoted}`], { encoding: 'utf8' });
        expect(JSON.parse(heard)).toEqual(body);
    });

    it('builds the SDK call with every field the page sent', () => {
        const sdk = snippet('sdk', body, 'http://box:8081');
        expect(sdk).toContain("new RhapsodeSdk({ baseUrl: 'http://box:8081/api' })");
        expect(sdk).toContain('"variant": "turbo"');
        expect(sdk).toContain('"stream": false');
    });
});

describe('RequestSnippet', () => {
    it('switches between curl and the SDK', async () => {
        const user = setupUser();
        render(<RequestSnippet body={body} />);

        expect(screen.getByText(/curl -X POST/)).toBeInTheDocument();
        await user.click(screen.getByText('TypeScript SDK'));
        expect(screen.getByText(/sdk\.public\.speak/)).toBeInTheDocument();
    });
});
