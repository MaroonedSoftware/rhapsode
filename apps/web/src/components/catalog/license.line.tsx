import { Group, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import type { License } from '@maroonedsoftware/rhapsode-sdk';

/**
 * Both licences, the weights one named separately, because it is the one package metadata never
 * reveals and the one that decides whether a commercial user may ship. protocol.md § 4.
 */
export function LicenseLine({ license }: { license: License }) {
    return (
        <Group gap="xs" wrap="wrap">
            <Text size="sm">
                Code <b>{license.code}</b>
            </Text>
            <Text size="sm" c="dimmed">
                ·
            </Text>
            <Text size="sm">
                Weights <b>{license.weights}</b>
            </Text>
            {license.weightsCommercialUse ? undefined : (
                <Tooltip label="The weights may not be used commercially">
                    <Group gap={4} c="yellow.7">
                        <IconAlertTriangle size={14} />
                        <Text size="sm" c="yellow.7">
                            Not for commercial use
                        </Text>
                    </Group>
                </Tooltip>
            )}
        </Group>
    );
}
