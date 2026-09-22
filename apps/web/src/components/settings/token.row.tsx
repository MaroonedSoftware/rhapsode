import { useState } from 'react';
import { Button, Group, PasswordInput, Stack, Text } from '@mantine/core';
import type { Settings } from '@maroonedsoftware/rhapsode-sdk';

import { ConfirmModal } from '../shared/confirm.modal';

export interface TokenRowProps {
    settings: Settings;
    /** A new token typed or generated here, not yet saved. The page never has the current one. */
    draft: string;
    onDraft: (token: string) => void;
    onRemove: () => void;
    removing: boolean;
}

/**
 * The management token: whether there is one, a new one, or none.
 *
 * The core never sends the token (§ 10), so there is nothing to show but whether one is set, and a
 * field for a new one. Generated here from the browser's own random source rather than suggested by
 * the core, so it crosses the network once, on its way in.
 */
export function TokenRow({ settings, draft, onDraft, onRemove, removing }: TokenRowProps) {
    const [confirming, setConfirming] = useState(false);
    const set = settings.values.management.tokenSet;

    return (
        <Stack gap={6}>
            <Text size="sm" fw={500}>
                Management token
            </Text>
            <Text size="xs" c="dimmed">
                {set ? 'A token is set. ' : 'No token is set, so only this machine can manage rhapsode. '}
                Installs run pip, so treat it as a root password for this box.
            </Text>
            <Group gap="xs" align="flex-end" wrap="wrap">
                <PasswordInput
                    aria-label="New management token"
                    placeholder={set ? 'A new token' : 'A token'}
                    value={draft}
                    onChange={event => onDraft(event.currentTarget.value)}
                    autoComplete="new-password"
                    spellCheck={false}
                    w={360}
                    maw="100%"
                />
                <Button variant="default" onClick={() => onDraft(generate())}>
                    Generate
                </Button>
                {set ? (
                    <Button variant="subtle" color="red" onClick={() => setConfirming(true)}>
                        Remove the token
                    </Button>
                ) : undefined}
            </Group>
            <ConfirmModal
                opened={confirming}
                onClose={() => setConfirming(false)}
                onConfirm={() => {
                    onRemove();
                    setConfirming(false);
                }}
                title="Remove the management token?"
                confirmLabel="Remove the token"
                confirming={removing}
            >
                From the next restart only this machine can install engines or change settings. A page or a script on another machine that uses the
                token will be refused.
            </ConfirmModal>
        </Stack>
    );
}

/** 32 random bytes as base64url, which is the Docker image's own and a valid bearer token. */
function generate(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}
