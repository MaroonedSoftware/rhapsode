import { Alert, Anchor, Code, Stack, Text } from '@mantine/core';

import { useUpdateStatus } from '../../api/update.queries';
import { severityColor } from '../shared/status';

/**
 * A newer release is out, and what to run for it. § 9.
 *
 * Shown only when the core says `updateAvailable`: it does the comparison, so the page never orders
 * two versions itself. The core cannot replace its own container, so for the image this is the
 * command, in both of its forms, because nothing inside the container can see whether the operator's
 * compose file pins `RHAPSODE_VERSION`.
 */
export function UpdateBanner() {
    const { data } = useUpdateStatus();
    if (data?.updateAvailable !== true || data.latest === undefined) return undefined;

    return (
        <Alert color={severityColor.info} title={`Rhapsode ${data.latest} is out`} mb="lg">
            <Stack gap="xs">
                <Text size="sm">
                    This server runs {data.version}.{' '}
                    {data.releaseUrl === undefined ? undefined : (
                        <Anchor href={data.releaseUrl} target="_blank" rel="noreferrer" size="sm">
                            What changed
                        </Anchor>
                    )}
                </Text>
                {data.distribution === 'docker' ? (
                    <>
                        <Text size="sm">Beside your compose.yaml:</Text>
                        <Code block>docker compose pull && docker compose up -d</Code>
                        <Text size="sm" c="dimmed">
                            If your compose pins <Code>RHAPSODE_VERSION</Code>, set it to <Code>{data.latest}</Code> first. Once the new server is up,
                            reinstall the engines this page marks as behind.
                        </Text>
                    </>
                ) : (
                    <Text size="sm">
                        Check out <Code>v{data.latest}</Code>, run <Code>pnpm install && pnpm build</Code>, and restart the server. Then reinstall the
                        engines this page marks as behind.
                    </Text>
                )}
            </Stack>
        </Alert>
    );
}

/** The running core's version, for the header. From the same document as the banner, for display only. */
export function CoreVersion() {
    const { data } = useUpdateStatus();
    if (data === undefined) return undefined;
    return (
        <Text size="xs" c="dimmed" ml="auto" title="The version of the rhapsode server this page is talking to">
            v{data.version}
        </Text>
    );
}
