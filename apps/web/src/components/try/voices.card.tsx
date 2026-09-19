import { useState } from 'react';
import { ActionIcon, Badge, Button, Card, FileInput, Group, Stack, Text, Textarea, TextInput, Title, Tooltip } from '@mantine/core';
import { IconArrowsShuffle, IconMicrophone, IconPlayerPlay, IconTrash, IconUpload } from '@tabler/icons-react';
import type { Cloning, Voice } from '@maroonedsoftware/rhapsode-sdk';

import { BASE_URL } from '../../api/client';
import { useBlendVoice, useCloneVoice, useDeleteVoice } from '../../api/engines.queries';
import { ConfirmModal } from '../shared/confirm.modal';
import { ErrorAlert } from '../shared/error.alert';
import { notifySuccess } from '../shared/notify';

/** What § 7 allows as an id, so the form refuses what the server would, before the upload. */
const VOICE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** The server's cap, so a clip that will be refused is refused before it is sent. § 7. */
const MAX_BYTES = 25 * 1024 * 1024;

/** A reference of one of these is somebody speaking. Anything else, such as Kokoro's style vectors, is not. */
const AUDIO = new Set(['wav', 'mp3', 'flac', 'ogg']);

/** What the page offered before engines said what they take, and what it still offers when one does not. */
const AUDIO_ACCEPT = 'audio/wav,audio/x-wav,audio/mpeg,audio/flac,audio/ogg,.wav,.mp3,.flac,.ogg';

/** A voice this page may delete: one somebody made, rather than one the engine ships. */
const MADE = ['cloned', 'blended', 'uploaded'];

export interface VoicesCardProps {
    engine: string;
    voices: Voice[];
    /**
     * The chosen variant's cloning claim, which also says what files it makes voices from. The form
     * is offered unless it says no: absent means a worker too old to say, and the worker refuses a
     * clone it cannot make anyway. § 4.
     */
    cloning?: Cloning;
    /** Whether the chosen variant mixes a voice from others. Absent means no. § 4. */
    blending?: boolean;
    /** Called with a new voice's id, so the page can select it. */
    onCloned: (id: string) => void;
}

/** This engine's voices: hear each, make one from a file or a blend, delete one that was made. */
export function VoicesCard({ engine, voices, cloning, blending, onCloned }: VoicesCardProps) {
    const remove = useDeleteVoice(engine);
    const [playing, setPlaying] = useState<string | undefined>(undefined);
    const [removing, setRemoving] = useState<Voice | undefined>(undefined);
    const clones = cloning?.supported !== false;

    return (
        <Card>
            <Stack gap="md">
                <Title order={2} size="h4">
                    Voices
                </Title>
                <Stack gap={6}>
                    {voices.length === 0 ? (
                        <Text size="sm" c="dimmed">
                            {clones || blending
                                ? 'This engine has no voices yet. Make one below, or speak in its default.'
                                : 'This engine has no voices to list. It speaks in its default.'}
                        </Text>
                    ) : undefined}
                    {voices.map(voice => {
                        const made = voice.tags?.find(tag => MADE.includes(tag));
                        return (
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
                                    {made ? (
                                        <Badge size="xs" variant="light">
                                            {made}
                                        </Badge>
                                    ) : undefined}
                                </Group>
                                {made ? (
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
                        );
                    })}
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

                {clones ? <CloneForm engine={engine} cloning={cloning} onCloned={onCloned} /> : undefined}
                {blending ? <BlendForm engine={engine} voices={voices} onCloned={onCloned} /> : undefined}
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
                It is removed from this machine. Lines already spoken in it are not affected.
            </ConfirmModal>
        </Card>
    );
}

interface CloneFormProps {
    engine: string;
    cloning?: Cloning;
    onCloned: (id: string) => void;
}

/**
 * A voice from a file. Which files, and whether they are recordings at all, is the capability
 * document's to say: Chatterbox takes a clip of somebody speaking, Kokoro a style vector. § 7.
 */
function CloneForm({ engine, cloning, onCloned }: CloneFormProps) {
    const clone = useCloneVoice(engine);
    const [id, setId] = useState('');
    const [label, setLabel] = useState('');
    const [transcript, setTranscript] = useState('');
    const [file, setFile] = useState<File | null>(null);

    const formats = cloning?.formats;
    const audio = formats === undefined || formats.some(format => AUDIO.has(format));
    const [low, high] = cloning?.referenceSeconds ?? [5, 20];
    const listed = (formats ?? ['wav', 'mp3', 'flac', 'ogg']).map(format => format.toUpperCase()).join(', ');

    const idError = idProblem(id);
    const fileError = file !== null && file.size > MAX_BYTES ? `${audio ? 'Clips' : 'Files'} are limited to 25 MB` : undefined;

    const submit = () => {
        if (file === null || idError || fileError || id === '') return;
        clone.mutate(
            { id, label, reference: file, ...(audio ? { transcript } : {}) },
            {
                onSuccess: voice => {
                    notifySuccess(`${voice.label} was ${audio ? 'cloned' : 'added'}.`);
                    onCloned(voice.id);
                    setId('');
                    setLabel('');
                    setTranscript('');
                    setFile(null);
                },
            },
        );
    };

    return (
        <Stack gap="xs">
            <Group gap="xs">
                {audio ? <IconMicrophone size={16} /> : <IconUpload size={16} />}
                <Text size="sm" fw={600}>
                    {audio ? 'Clone a voice' : 'Add a voice from a file'}
                </Text>
            </Group>
            <Text size="xs" c="dimmed">
                {audio
                    ? `${low} to ${high} seconds of one person speaking, with nothing else in the recording. ${listed}.`
                    : `A file this engine makes a voice from, not a recording: ${listed}.`}
            </Text>
            <FileInput
                aria-label={audio ? 'Reference clip' : 'Reference file'}
                placeholder={audio ? 'Choose a clip' : 'Choose a file'}
                accept={formats === undefined ? AUDIO_ACCEPT : formats.map(format => `.${format}`).join(',')}
                leftSection={<IconUpload size={14} />}
                value={file}
                onChange={setFile}
                error={fileError}
                clearable
            />
            <IdFields id={id} label={label} idError={idError} onId={setId} onLabel={setLabel} />
            {/* With a recording, always: the capability document cannot say which engines need the
                words, and one that does not read them ignores them. A style vector has none. § 7. */}
            {audio ? (
                <Textarea
                    label="Transcript"
                    description="What is said in the clip, word for word. Some engines need it to clone."
                    placeholder="Hello, this is how I sound."
                    autosize
                    minRows={2}
                    value={transcript}
                    onChange={event => setTranscript(event.currentTarget.value)}
                />
            ) : undefined}
            {clone.isError ? (
                <ErrorAlert title={`That voice was not ${audio ? 'cloned' : 'added'}`} error={clone.error} fallback="The server did not answer." />
            ) : undefined}
            <Group>
                <Button
                    onClick={submit}
                    loading={clone.isPending}
                    disabled={file === null || id === '' || idError !== undefined || fileError !== undefined}
                >
                    {audio ? 'Clone' : 'Add'}
                </Button>
            </Group>
        </Stack>
    );
}

interface BlendFormProps {
    engine: string;
    voices: Voice[];
    onCloned: (id: string) => void;
}

/** A voice mixed from others the engine has, kept under an id of its own. § 7. */
function BlendForm({ engine, voices, onCloned }: BlendFormProps) {
    const blend = useBlendVoice(engine);
    const [id, setId] = useState('');
    const [label, setLabel] = useState('');
    const [recipe, setRecipe] = useState('');

    const idError = idProblem(id);
    // An example drawn from this engine's own list, so the placeholder is something it would accept.
    const example = voices.length >= 2 ? `${voices[0]!.id}(2)+${voices[1]!.id}(1)` : 'first(2)+second(1)';

    const submit = () => {
        if (idError || id === '' || recipe.trim() === '') return;
        blend.mutate(
            { id, label, blend: recipe.trim() },
            {
                onSuccess: voice => {
                    notifySuccess(`${voice.label} was blended.`);
                    onCloned(voice.id);
                    setId('');
                    setLabel('');
                    setRecipe('');
                },
            },
        );
    };

    return (
        <Stack gap="xs">
            <Group gap="xs">
                <IconArrowsShuffle size={16} />
                <Text size="sm" fw={600}>
                    Blend a voice
                </Text>
            </Group>
            <Text size="xs" c="dimmed">
                Voices this engine has, each with an optional weight: name(weight)+name(weight). Mixed once and kept, so changing a part later does
                not change the blend.
            </Text>
            <TextInput label="Recipe" placeholder={example} value={recipe} onChange={event => setRecipe(event.currentTarget.value)} />
            <IdFields id={id} label={label} idError={idError} onId={setId} onLabel={setLabel} />
            {blend.isError ? <ErrorAlert title="That voice was not blended" error={blend.error} fallback="The server did not answer." /> : undefined}
            <Group>
                <Button onClick={submit} loading={blend.isPending} disabled={recipe.trim() === '' || id === '' || idError !== undefined}>
                    Blend
                </Button>
            </Group>
        </Stack>
    );
}

interface IdFieldsProps {
    id: string;
    label: string;
    idError?: string;
    onId: (id: string) => void;
    onLabel: (label: string) => void;
}

function IdFields({ id, label, idError, onId, onLabel }: IdFieldsProps) {
    return (
        <Group grow align="flex-start">
            <TextInput label="Id" placeholder="narrator_03" value={id} onChange={event => onId(event.currentTarget.value)} error={idError} />
            <TextInput label="Label" placeholder="Narrator 03" value={label} onChange={event => onLabel(event.currentTarget.value)} />
        </Group>
    );
}

function idProblem(id: string): string | undefined {
    return id !== '' && !VOICE_ID.test(id) ? 'Letters, digits, - and _, starting with a letter or digit' : undefined;
}
