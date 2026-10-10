import type { ReactNode } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { ErrorAlert } from './error.alert';

export interface ConfirmModalProps {
    opened: boolean;
    onClose: () => void;
    onConfirm: () => void;
    /** The question, as a question. */
    title: string;
    /** What goes, what stays, and what it costs. */
    children: ReactNode;
    /** The verb on the button that does it, never "OK". */
    confirmLabel: string;
    confirming?: boolean;
    /** Reported inside the dialog, because the dialog is where the person still is. */
    error?: unknown;
    errorFallback?: string;
    /**
     * `danger` for what cannot be taken back, which is the default; `default` for an action that
     * only costs time, such as a warm or a reinstall beside the old virtualenv. Red on everything
     * taught people to read red as "a dialog", which is the opposite of what it is for.
     */
    tone?: 'danger' | 'default';
}

/** Asking before something costly or that cannot be taken back, with room for a pending state and an error. */
export function ConfirmModal({
    opened,
    onClose,
    onConfirm,
    title,
    children,
    confirmLabel,
    confirming = false,
    error,
    errorFallback = 'Nothing was changed.',
    tone = 'danger',
}: ConfirmModalProps) {
    return (
        <Modal opened={opened} onClose={onClose} title={title} centered>
            <Stack gap="md">
                {typeof children === 'string' ? <Text size="sm">{children}</Text> : children}
                {error ? <ErrorAlert title="That could not be done" error={error} fallback={errorFallback} /> : undefined}
                <Group justify="flex-end">
                    <Button variant="default" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button color={tone === 'danger' ? 'red' : undefined} loading={confirming} onClick={onConfirm}>
                        {confirmLabel}
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}
