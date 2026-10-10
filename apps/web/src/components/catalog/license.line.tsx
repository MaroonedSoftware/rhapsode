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
                    {/* The amber goes on the icon only: yellow.7 text on white measured 2.1:1, under
                        WCAG's 4.5:1, and the icon and the words already say it without the colour. */}
                    <Group gap={4}>
                        <IconAlertTriangle size={14} color="var(--mantine-color-yellow-7)" aria-hidden />
                        <Text size="sm" fw={500}>
                            Not for commercial use
                        </Text>
                    </Group>
                </Tooltip>
            )}
        </Group>
    );
}
