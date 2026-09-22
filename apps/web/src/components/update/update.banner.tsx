import { ActionIcon, Alert, Anchor, Button, Code, Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';

import { useCheckForUpdate, useUpdateStatus } from '../../api/update.queries';
import { notifyFailure, notifySuccess } from '../shared/notify';
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

/**
 * The running core's version, for the header, and the means to ask whether it is still the latest.
 *
 * The button asks the core to check now (`POST /update/check`), because the answer the core keeps
 * stands a day, and a person who has just read that a release is out wants to know today. A newer
 * release brings up the banner; anything else is said once and goes. Absent while the operator has
 * turned the check off: a button that could only ever say so would be one to remove.
 */
export function CoreVersion() {
    const { data } = useUpdateStatus();
    const check = useCheckForUpdate();
    if (data === undefined) return undefined;

    const ask = () =>
        check.mutate(undefined, {
            onSuccess: status => {
                if (status.check === 'failed') {
                    notifyFailure('Could not check for updates', undefined, 'The server could not reach GitHub. It will try again on its own.');
                } else if (status.check === 'ok' && status.updateAvailable !== true) {
                    notifySuccess(`Rhapsode ${status.version} is the latest release.`);
                }
            },
            onError: error => notifyFailure('Could not check for updates', error, 'The rhapsode server did not answer.'),
        });

    return (
        <Group gap={4} ml="auto" wrap="nowrap">
            {/* On a phone the version goes into the button's tooltip: with both, the button fell 23 px off a 375 px screen. */}
            <Text
                size="xs"
                c="dimmed"
                title="The version of the rhapsode server this page is talking to"
                visibleFrom={data.check === 'off' ? undefined : 'sm'}
            >
                v{data.version}
            </Text>
            {data.check === 'off' ? undefined : (
                <>
                    <Button
                        variant="subtle"
                        size="compact-xs"
                        leftSection={<IconRefresh size={12} />}
                        loading={check.isPending}
                        onClick={ask}
                        visibleFrom="sm"
                    >
                        Check for updates
                    </Button>
                    {/* The label alone would push the page links off a phone's header, as the name did. */}
                    <Tooltip label={`v${data.version}. Check for updates`}>
                        <ActionIcon variant="subtle" size="sm" aria-label="Check for updates" loading={check.isPending} onClick={ask} hiddenFrom="sm">
                            <IconRefresh size={14} />
                        </ActionIcon>
                    </Tooltip>
                </>
            )}
        </Group>
    );
}
