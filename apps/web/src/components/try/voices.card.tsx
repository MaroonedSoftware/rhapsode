import { useState } from 'react';
import { ActionIcon, Badge, Button, Card, FileInput, Group, Stack, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { IconMicrophone, IconPlayerPlay, IconTrash, IconUpload } from '@tabler/icons-react';
import type { Cloning, Voice } from '@maroonedsoftware/rhapsode-sdk';

import { BASE_URL } from '../../api/client';
import { useCloneVoice, useDeleteVoice } from '../../api/engines.queries';
import { ConfirmModal } from '../shared/confirm.modal';
import { ErrorAlert } from '../shared/error.alert';
import { notifySuccess } from '../shared/notify';

/** What § 7 allows as an id, so the form refuses what the server would, before the upload. */
const VOICE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** The server's cap, so a clip that will be refused is refused before it is sent. § 7. */
const MAX_BYTES = 25 * 1024 * 1024;

export interface VoicesCardProps {
    engine: string;
    voices: Voice[];
    /**
     * The chosen variant's cloning claim. The form is offered unless it says no: absent means a
     * worker too old to say, and the worker refuses a clone it cannot make anyway. § 4.
     */
    cloning?: Cloning;
    /** Called with a new clone's id, so the page can select it. */
    onCloned: (id: string) => void;
}

/** This engine's voices: hear each, clone a new one from a clip where it can, delete a clone. */
export function VoicesCard({ engine, voices, cloning, onCloned }: VoicesCardProps) {
    const clone = useCloneVoice(engine);
    const remove = useDeleteVoice(engine);
    const [id, setId] = useState('');
    const [label, setLabel] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [playing, setPlaying] = useState<string | undefined>(undefined);
    const [removing, setRemoving] = useState<Voice | undefined>(undefined);

    const idError = id !== '' && !VOICE_ID.test(id) ? 'Letters, digits, - and _, starting with a letter or digit' : undefined;
    const fileError = file !== null && file.size > MAX_BYTES ? 'Clips are limited to 25 MB' : undefined;
    const clones = cloning?.supported !== false;
    const [low, high] = cloning?.referenceSeconds ?? [5, 20];

    const submit = () => {
        if (file === null || idError || fileError || id === '') return;
        clone.mutate(
            { id, label, reference: file },
            {
                onSuccess: voice => {
                    notifySuccess(`${voice.label} was cloned.`);
                    onCloned(voice.id);
                    setId('');
                    setLabel('');
                    setFile(null);
                },
            },
        );
    };

    return (
        <Card>
            <Stack gap="md">
                <Title order={2} size="h4">
                    Voices
                </Title>
                <Stack gap={6}>
                    {voices.length === 0 ? (
                        <Text size="sm" c="dimmed">
                            {clones
                                ? 'This engine has no voices yet. Clone one from a clip below, or speak in its default.'
                                : 'This engine has no voices to list. It speaks in its default.'}
                        </Text>
                    ) : undefined}
                    {voices.map(voice => (
                        <Group key={voice.id} justify="space-between" wrap="nowrap">
                            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                                {voice.previewUrl ? (
                                    <Tooltip label="Hear a preview">
                                        <ActionIcon variant="light" aria-label={`Preview ${voice.label}`} onClick={() => setPlaying(voice.spec)}>
                                            <IconPlayerPlay size={14} />
                                        </ActionIcon>
                                    </Tooltip>
                                ) : undefined}
                                <Text size="sm" truncate>
                                    {voice.label}
                                </Text>
                                {voice.tags?.includes('cloned') ? (
                                    <Badge size="xs" variant="light">
                                        cloned
                                    </Badge>
                                ) : undefined}
                            </Group>
                            {voice.tags?.includes('cloned') ? (
                                <ActionIcon
                                    variant="subtle"
                                    color="red"
                                    aria-label={`Delete ${voice.label}`}
                                    onClick={() => {
                                        remove.reset();
                                        setRemoving(voice);
                                    }}
                                >
                                    <IconTrash size={14} />
                                </ActionIcon>
                            ) : undefined}
                        </Group>
                    ))}
                    {/* Keyed on the spec, which changes whenever the rendering would, so a re-recorded
                        voice is heard afresh rather than from the browser's cache. § 7. */}
                    {playing !== undefined
                        ? (() => {
                              const voice = voices.find(entry => entry.spec === playing);
                              return voice?.previewUrl ? (
                                  <audio
                                      key={playing}
                                      controls
                                      autoPlay
                                      src={`${BASE_URL}${voice.previewUrl}?spec=${encodeURIComponent(voice.spec)}`}
                                      style={{ width: '100%' }}
                                      aria-label={`Preview of ${voice.label}`}
                                  />
                              ) : undefined;
                          })()
                        : undefined}
                </Stack>

                {clones ? (
                    <Stack gap="xs">
                        <Group gap="xs">
                            <IconMicrophone size={16} />
                            <Text size="sm" fw={600}>
                                Clone a voice
                            </Text>
                        </Group>
                        <Text size="xs" c="dimmed">
                            {low} to {high} seconds of one person speaking, with nothing else in the recording. WAV, MP3, FLAC or OGG.
                        </Text>
                        <FileInput
                            aria-label="Reference clip"
                            placeholder="Choose a clip"
                            accept="audio/wav,audio/x-wav,audio/mpeg,audio/flac,audio/ogg,.wav,.mp3,.flac,.ogg"
                            leftSection={<IconUpload size={14} />}
                            value={file}
                            onChange={setFile}
                            error={fileError}
                            clearable
                        />
                        <Group grow align="flex-start">
                            <TextInput
                                label="Id"
                                placeholder="narrator_03"
                                value={id}
                                onChange={event => setId(event.currentTarget.value)}
                                error={idError}
                            />
                            <TextInput
                                label="Label"
                                placeholder="Narrator 03"
                                value={label}
                                onChange={event => setLabel(event.currentTarget.value)}
                            />
                        </Group>
                        {clone.isError ? (
                            <ErrorAlert title="That voice was not cloned" error={clone.error} fallback="The server did not answer." />
                        ) : undefined}
                        <Group>
                            <Button
                                onClick={submit}
                                loading={clone.isPending}
                                disabled={file === null || id === '' || idError !== undefined || fileError !== undefined}
                            >
                                Clone
                            </Button>
                        </Group>
                    </Stack>
                ) : undefined}
            </Stack>

            <ConfirmModal
                opened={removing !== undefined}
                onClose={() => setRemoving(undefined)}
                onConfirm={() => {
                    if (removing === undefined) return;
                    const name = removing.label;
                    remove.mutate(removing.id, {
                        onSuccess: () => {
                            setRemoving(undefined);
                            notifySuccess(`${name} was deleted.`);
                        },
                    });
                }}
                title={removing ? `Delete ${removing.label}?` : ''}
                confirmLabel="Delete"
                confirming={remove.isPending}
                error={remove.error ?? undefined}
            >
                Its reference clip is removed from this machine. Lines already spoken in it are not affected.
            </ConfirmModal>
        </Card>
    );
}
