import { useState } from 'react';
import { Alert, Button, Checkbox, Group, Modal, Stack, Text } from '@mantine/core';
import type { CatalogEntry } from '@maroonedsoftware/rhapsode-sdk';

import { LicenseLine } from '../catalog/license.line';
import { ErrorAlert } from '../shared/error.alert';

export interface InstallModalProps {
    entry: CatalogEntry | undefined;
    onClose: () => void;
    /** With the variant to download in the same job, or undefined for the install alone. */
    onConfirm: (pull: string | undefined) => void;
    installing: boolean;
    error?: unknown;
}

/**
 * Both licences, then the button. The weights licence is the one that decides whether a commercial
 * user may ship, and it is only worth reading before the install, so it is put in front of the
 * person at the one moment it can change what they do. protocol.md § 4.
 */
export function InstallModal({ entry, onClose, onConfirm, installing, error }: InstallModalProps) {
    // On by default: an engine installed without its weights makes its first request wait on the
    // whole download, 3.8 GB for Chatterbox's turbo, which is not what "installed" sounds like.
    const [pull, setPull] = useState(true);
    const variant = entry?.defaultVariant;

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
                    {variant === undefined ? undefined : (
                        <Checkbox
                            checked={pull}
                            onChange={event => setPull(event.currentTarget.checked)}
                            label={`Download the ${variant} weights too`}
                            description="So its first request only has to load them, rather than wait for the download."
                        />
                    )}
                    {error ? <ErrorAlert title="The install did not start" error={error} fallback="The server did not answer." /> : undefined}
                    <Group justify="flex-end">
                        <Button variant="default" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button loading={installing} onClick={() => onConfirm(pull && variant !== undefined ? variant : undefined)}>
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
