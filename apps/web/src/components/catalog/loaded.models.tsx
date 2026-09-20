import { Badge, Button, Card, Group, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconEraser } from '@tabler/icons-react';
import { DateTime } from 'luxon';
import type { ResidentModel } from '@maroonedsoftware/rhapsode-sdk';

import { useResidency, useUnloadEngine } from '../../api/residency.queries';
import { apiErrorCode } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { notifyFailure, notifySuccess } from '../shared/notify';

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;

/** Binary units, because that is what a card is sold and measured in. */
function describeSize(bytes: number | undefined): string {
    // Absent is not zero: § 3 has a worker leave the field out when nothing could measure it, and
    // printing "0 B" would put the invented number back.
    if (bytes === undefined) return '—';
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
}

function describeExpiry(model: ResidentModel): string {
    if (model.leases > 0) return `speaking (${model.leases})`;
    if (model.expiresAt === undefined) return 'never';

    const seconds = Math.round(DateTime.fromISO(model.expiresAt).diffNow().as('seconds'));
    if (seconds <= 0) return 'any moment';
    if (seconds < 60) return `in ${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `in ${minutes}m ${seconds % 60}s`;
    return `in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * What this server has on the card, and the means to give it back. § 3.
 *
 * The one polled query in the page: everything else changes only when something here asks it to,
 * and a keep-alive runs out on its own.
 */
export function LoadedModels() {
    const residency = useResidency();
    const unload = useUnloadEngine();

    // The same argument the catalog makes about the job list: a page from another machine may read
    // this and is refused the unload, so the buttons are not offered rather than offered and failing.
    const managed = !(residency.isError && apiErrorCode(residency.error) === 'forbidden');

    const free = (model: ResidentModel) =>
        unload.mutate(
            { engine: model.engine },
            {
                onSuccess: () => notifySuccess(`${model.engine} let its card go.`),
                onError: error =>
                    notifyFailure(
                        `${model.engine} is still loaded`,
                        error,
                        // A 409 is not a failure to fix: it is a state to wait out.
                        'The server did not answer.',
                    ),
            },
        );

    if (residency.isError) {
        return <ErrorAlert title="What is loaded did not load" error={residency.error} fallback="The rhapsode server did not answer." />;
    }

    const models = residency.data?.models ?? [];

    return (
        <Stack gap="sm">
            <Group justify="space-between" align="baseline">
                <Title order={2} size="h3">
                    On the card
                </Title>
                {residency.data === undefined ? undefined : (
                    <Text size="sm" c="dimmed">
                        {residency.data.resident} of {residency.data.max} resident
                        {residency.data.waiting > 0
                            ? `, ${residency.data.waiting} waiting${residency.data.blockedBy === undefined ? '' : ` behind ${residency.data.blockedBy}`}`
                            : ''}
                    </Text>
                )}
            </Group>

            <Card padding="xs">
                {models.length === 0 ? (
                    <Text size="sm" c="dimmed" p="sm">
                        Nothing is loaded. A model arrives when something asks an engine to speak, and leaves again when its keep-alive runs out.
                    </Text>
                ) : (
                    <Table highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Engine</Table.Th>
                                <Table.Th>Variant</Table.Th>
                                <Table.Th>Size</Table.Th>
                                <Table.Th>Expires</Table.Th>
                                {managed ? <Table.Th /> : undefined}
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {models.map(model => (
                                <Table.Tr key={model.engine}>
                                    <Table.Td>
                                        <Text fw={600} size="sm">
                                            {model.engine}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Text size="sm">{model.variant}</Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Text size="sm">{describeSize(model.sizeBytes)}</Text>
                                    </Table.Td>
                                    <Table.Td>
                                        {model.leases > 0 ? (
                                            <Badge variant="light" size="sm">
                                                {describeExpiry(model)}
                                            </Badge>
                                        ) : (
                                            <Text size="sm" c="dimmed">
                                                {describeExpiry(model)}
                                            </Text>
                                        )}
                                    </Table.Td>
                                    {managed ? (
                                        <Table.Td ta="right">
                                            {/* Refused with a 409 while it is speaking, so it is not offered then. */}
                                            <Tooltip label="Wait for it to finish speaking" disabled={model.leases === 0}>
                                                <Button
                                                    variant="subtle"
                                                    size="xs"
                                                    leftSection={<IconEraser size={14} />}
                                                    disabled={model.leases > 0}
                                                    loading={unload.isPending && unload.variables?.engine === model.engine}
                                                    onClick={() => free(model)}
                                                >
                                                    Unload
                                                </Button>
                                            </Tooltip>
                                        </Table.Td>
                                    ) : undefined}
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                )}
            </Card>
        </Stack>
    );
}
