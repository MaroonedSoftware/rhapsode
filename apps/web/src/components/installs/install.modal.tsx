import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';
import type { CatalogEntry } from '@rhapsode/sdk';

import { LicenseLine } from '../catalog/license.line';
import { ErrorAlert } from '../shared/error.alert';

export interface InstallModalProps {
    entry: CatalogEntry | undefined;
    onClose: () => void;
    onConfirm: () => void;
    installing: boolean;
    error?: unknown;
}

/**
 * Both licences, then the button. The weights licence is the one that decides whether a commercial
 * user may ship, and it is only worth reading before the install, so it is put in front of the
 * person at the one moment it can change what they do. protocol.md § 4.
 */
export function InstallModal({ entry, onClose, onConfirm, installing, error }: InstallModalProps) {
    return (
        <Modal opened={entry !== undefined} onClose={onClose} title={entry ? `Install ${entry.displayName}?` : undefined} centered>
            {entry ? (
                <Stack gap="md">
                    <Text size="sm">
                        The server builds {entry.displayName} its own virtualenv and installs <Code>{entry.package}</Code> into it. Nothing else on
                        this machine changes.
                    </Text>
                    <LicenseLine license={entry.license} />
                    {entry.license.weightsCommercialUse ? undefined : (
                        <Alert color="yellow" title="Check the weights licence">
                            These weights may not be used commercially. The code licence does not change that.
                        </Alert>
                    )}
                    {error ? <ErrorAlert title="The install did not start" error={error} fallback="The server did not answer." /> : undefined}
                    <Group justify="flex-end">
                        <Button variant="default" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button loading={installing} onClick={onConfirm}>
                            Install under these licences
                        </Button>
                    </Group>
                </Stack>
            ) : undefined}
        </Modal>
    );
}

function Code({ children }: { children: string }) {
    return (
        <Text span ff="monospace" size="sm">
            {children}
        </Text>
    );
}
