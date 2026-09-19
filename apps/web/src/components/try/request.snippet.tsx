import { useState } from 'react';
import { ActionIcon, Anchor, Code, CopyButton, Group, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import type { EngineSpeakRequest } from '@maroonedsoftware/rhapsode-sdk';

import { BASE_URL } from '../../api/client';

type Form = 'curl' | 'sdk';

/** A string inside single quotes in a POSIX shell, which has no escape: close, escape, reopen. */
const shellQuoted = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * The same request as a call a person can run.
 *
 * Through the page's own origin and `/api`, the address this page reaches the core at, because it is
 * the only one the page knows is right: the core's own port is behind the proxy and may not be
 * reachable from wherever the page was opened.
 */
export function snippet(form: Form, body: EngineSpeakRequest, origin: string): string {
    const base = `${origin}${BASE_URL}`;
    if (form === 'curl') {
        return [
            `curl -X POST ${base}/speak \\`,
            `  -H 'Content-Type: application/json' \\`,
            `  -d ${shellQuoted(JSON.stringify(body))} \\`,
            `  -o line.${body.format ?? 'wav'}`,
        ].join('\n');
    }
    return [
        "import { RhapsodeSdk } from '@maroonedsoftware/rhapsode-sdk';",
        '',
        `const sdk = new RhapsodeSdk({ baseUrl: '${base}' });`,
        `const result = await sdk.public.speak(${JSON.stringify(body, undefined, 4)});`,
        '// A refusal is a value, not a throw: result.data is the audio only when the status is 200.',
        "if (result.status === 200) console.log('spoken', result.data.size, 'bytes');",
    ].join('\n');
}

export function RequestSnippet({ body }: { body: EngineSpeakRequest }) {
    const [form, setForm] = useState<Form>('curl');
    const text = snippet(form, body, window.location.origin);
    return (
        <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap">
                <SegmentedControl
                    size="xs"
                    aria-label="Request as"
                    data={[
                        { value: 'curl', label: 'curl' },
                        { value: 'sdk', label: 'TypeScript SDK' },
                    ]}
                    value={form}
                    onChange={value => setForm(value as Form)}
                />
                <CopyButton value={text} timeout={1500}>
                    {({ copied, copy }) => (
                        <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow>
                            <ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy} aria-label="Copy the request">
                                {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                            </ActionIcon>
                        </Tooltip>
                    )}
                </CopyButton>
            </Group>
            <Code block fz="xs" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {text}
            </Code>
            <Text size="xs" c="dimmed">
                The request this page sends for the choices above. Every field it can carry is in the{' '}
                <Anchor size="xs" renderRoot={(props: object) => <Link to="/reference" {...props} />}>
                    API reference
                </Anchor>{' '}
                under <Code>POST /speak</Code>.
            </Text>
        </Stack>
    );
}
