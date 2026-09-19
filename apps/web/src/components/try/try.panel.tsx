import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Group, NumberInput, SegmentedControl, Select, SimpleGrid, Slider, Stack, Text, Textarea, Title } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';
import type { Variant, Voice } from '@maroonedsoftware/rhapsode-sdk';

import { useCapabilities, useDialogue, useSpeak, useVoices, type Spoken } from '../../api/engines.queries';
import { ErrorAlert } from '../shared/error.alert';
import { PageSkeleton } from '../shared/page.skeleton';
import { DialogueEditor, SAMPLE_TURNS, speakerLabel, type EditedTurn } from './dialogue.editor';
import { VoicesCard } from './voices.card';

const SAMPLE = 'Right, that was The Verve Pipe. [laugh] Nobody warned me about that intro.';

/** How long a request runs before the page says why: a first request loads the model. */
const SLOW_MS = 3000;

export interface TryPanelProps {
    engine: string;
    defaultVariant?: string;
}

export function TryPanel({ engine, defaultVariant }: TryPanelProps) {
    const capabilities = useCapabilities(engine);
    const voices = useVoices(engine);

    if (capabilities.isPending) return <PageSkeleton variant="card" />;
    if (capabilities.isError)
        return <ErrorAlert title="This engine did not answer" error={capabilities.error} fallback="Its worker did not start." />;

    const variants = capabilities.data.variants;
    const names = Object.keys(variants);
    // The loaded variant first, so the first request needs no swap, then the engine's own default.
    const initial = [capabilities.data.current?.variant, defaultVariant, names[0]].find(name => name !== undefined && name in variants)!;

    return (
        <Controls
            key={initial}
            engine={engine}
            variants={variants}
            initial={initial}
            voices={voices.data ?? []}
            referenceSeconds={capabilities.data.current?.cloning.referenceSeconds}
        />
    );
}

interface ControlsProps {
    engine: string;
    variants: Record<string, Variant>;
    initial: string;
    voices: Voice[];
    referenceSeconds?: number[];
}

function Controls({ engine, variants, initial, voices, referenceSeconds }: ControlsProps) {
    const speak = useSpeak();
    const converse = useDialogue();
    const [variant, setVariant] = useState(initial);
    const [mode, setMode] = useState<'line' | 'dialogue'>('line');
    const [turns, setTurns] = useState<EditedTurn[]>(SAMPLE_TURNS);
    const [speakerVoices, setSpeakerVoices] = useState<Record<number, string>>({});
    const [voice, setVoice] = useState<string | undefined>(undefined);
    const [text, setText] = useState(SAMPLE);
    const [delivery, setDelivery] = useState<string>('');
    const [dials, setDials] = useState<Record<string, number>>({});
    const [language, setLanguage] = useState<string | undefined>(undefined);
    const [seed, setSeed] = useState<number | undefined>(undefined);
    const [played, setPlayed] = useState<Spoken | undefined>(undefined);
    const [slow, setSlow] = useState(false);
    const textarea = useRef<HTMLTextAreaElement>(null);

    const claims = variants[variant]!;
    const languages = claims.languages ?? [];
    // Offered only where the variant declares it, which is the whole of how the page knows. § 4.
    const dialogue = mode === 'dialogue' && claims.dialogue !== undefined;
    const asking = dialogue ? converse : speak;
    const spokenTurns = turns.filter(turn => turn.text.trim() !== '');

    // The previous line's URL is released when it is replaced, and the last when the panel goes.
    useEffect(
        () => () => {
            if (played) URL.revokeObjectURL(played.url);
        },
        [played],
    );

    const changeVariant = (next: string) => {
        setVariant(next);
        // A delivery or a dial one build claims means nothing on another, and the core would refuse
        // the dial by name. The text stays: the core strips cues the new build does not perform.
        setDelivery('');
        setDials({});
        setLanguage(undefined);
        if (variants[next]?.dialogue === undefined) setMode('line');
    };

    const insertCue = (cue: string) => {
        const element = textarea.current;
        const tag = `[${cue}]`;
        if (!element) return setText(current => `${current} ${tag}`);
        const { selectionStart, selectionEnd } = element;
        setText(current => `${current.slice(0, selectionStart)}${tag}${current.slice(selectionEnd)}`);
        requestAnimationFrame(() => {
            element.focus();
            element.setSelectionRange(selectionStart + tag.length, selectionStart + tag.length);
        });
    };

    const say = () => {
        setSlow(false);
        const timer = setTimeout(() => setSlow(true), SLOW_MS);
        const settle = {
            onSuccess: (spoken: Spoken) => setPlayed(spoken),
            onSettled: () => {
                clearTimeout(timer);
                setSlow(false);
            },
        };
        if (dialogue) {
            // A voice only for a speaker who has a turn: the core refuses one for anybody else.
            const speaking = new Set(spokenTurns.map(turn => turn.speaker));
            const voices = Object.fromEntries(
                Object.entries(speakerVoices)
                    .filter(([speaker]) => speaking.has(Number(speaker)))
                    .map(([speaker, id]) => [speakerLabel(Number(speaker)), id]),
            );
            converse.mutate(
                {
                    engine,
                    variant,
                    turns: spokenTurns.map(turn => ({ speaker: speakerLabel(turn.speaker), text: turn.text })),
                    ...(Object.keys(voices).length === 0 ? {} : { voices }),
                    ...(Object.keys(dials).length === 0 ? {} : { params: dials }),
                    ...(language === undefined ? {} : { language }),
                    ...(seed === undefined ? {} : { seed }),
                },
                settle,
            );
            return;
        }
        speak.mutate(
            {
                engine,
                text,
                variant,
                ...(voice === undefined ? {} : { voice }),
                ...(delivery === '' ? {} : { delivery: delivery as 'hushed' | 'frantic' }),
                ...(Object.keys(dials).length === 0 ? {} : { params: dials }),
                ...(language === undefined ? {} : { language }),
                ...(seed === undefined ? {} : { seed }),
            },
            settle,
        );
    };

    return (
        <Stack gap="lg">
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
                <Card>
                    <Stack gap="md">
                        <Select
                            label="Variant"
                            description="Which build of the engine. Each performs different things."
                            data={Object.keys(variants)}
                            value={variant}
                            onChange={value => value && changeVariant(value)}
                            allowDeselect={false}
                        />
                        {claims.dialogue !== undefined ? (
                            <Stack gap={4}>
                                <Text size="sm" fw={500}>
                                    Speak
                                </Text>
                                <SegmentedControl
                                    data={[
                                        { value: 'line', label: 'A line' },
                                        { value: 'dialogue', label: `A conversation, up to ${claims.dialogue.maxSpeakers}` },
                                    ]}
                                    value={mode}
                                    onChange={value => setMode(value as 'line' | 'dialogue')}
                                />
                            </Stack>
                        ) : undefined}
                        {dialogue ? undefined : (
                            <Select
                                label="Voice"
                                placeholder="The engine's default"
                                data={voices.map(entry => ({ value: entry.id, label: entry.label }))}
                                value={voice !== undefined && voices.some(entry => entry.id === voice) ? voice : null}
                                onChange={value => setVoice(value ?? undefined)}
                                clearable
                            />
                        )}
                        {languages.length > 1 ? (
                            <Select
                                label="Language"
                                data={languages}
                                value={language ?? languages[0]}
                                onChange={value => setLanguage(value ?? undefined)}
                            />
                        ) : undefined}
                        {claims.deliveries.length > 0 && !dialogue ? (
                            <Stack gap={4}>
                                <Text size="sm" fw={500}>
                                    Delivery
                                </Text>
                                <SegmentedControl
                                    data={[{ value: '', label: 'Ordinary' }, ...claims.deliveries.map(entry => ({ value: entry, label: entry }))]}
                                    value={delivery}
                                    onChange={setDelivery}
                                />
                            </Stack>
                        ) : undefined}
                        {Object.entries(claims.dials).map(([name, dial]) => (
                            <Stack key={name} gap={4}>
                                <Group justify="space-between">
                                    <Text size="sm" fw={500}>
                                        {name}
                                    </Text>
                                    <Text size="sm" c="dimmed" className="rh-num">
                                        {(dials[name] ?? dial.default).toFixed(2)}
                                    </Text>
                                </Group>
                                <Slider
                                    thumbLabel={name}
                                    min={dial.min}
                                    max={dial.max}
                                    step={(dial.max - dial.min) / 100}
                                    value={dials[name] ?? dial.default}
                                    onChange={value => setDials(current => ({ ...current, [name]: value }))}
                                    label={value => value.toFixed(2)}
                                />
                            </Stack>
                        ))}
                        <NumberInput
                            label="Seed"
                            description="The same seed and line give the same audio, on engines that honour one."
                            placeholder="Random"
                            value={seed ?? ''}
                            onChange={value => setSeed(typeof value === 'number' ? value : undefined)}
                            allowDecimal={false}
                            min={0}
                        />
                    </Stack>
                </Card>

                <Card>
                    <Stack gap="md">
                        <Title order={2} size="h4">
                            {dialogue ? 'Conversation' : 'Line'}
                        </Title>
                        {dialogue ? (
                            <DialogueEditor
                                turns={turns}
                                onTurns={setTurns}
                                voices={speakerVoices}
                                onVoices={setSpeakerVoices}
                                maxSpeakers={claims.dialogue!.maxSpeakers}
                                engineVoices={voices}
                                cues={claims.cues}
                            />
                        ) : (
                            <>
                                <Textarea
                                    ref={textarea}
                                    aria-label="Line"
                                    value={text}
                                    onChange={event => setText(event.currentTarget.value)}
                                    autosize
                                    minRows={4}
                                />
                                {claims.cues.length > 0 ? (
                                    <Stack gap={4}>
                                        <Text size="xs" c="dimmed">
                                            Cues this variant performs. Click to insert at the cursor.
                                        </Text>
                                        <Group gap={6}>
                                            {claims.cues.map(cue => (
                                                <Button key={cue} variant="light" size="compact-xs" radius="xl" onClick={() => insertCue(cue)}>
                                                    {cue}
                                                </Button>
                                            ))}
                                        </Group>
                                    </Stack>
                                ) : (
                                    <Text size="xs" c="dimmed">
                                        This variant performs no cues. Any in the line are removed before it is spoken, so it never reads one out.
                                    </Text>
                                )}
                            </>
                        )}
                        <Group>
                            <Button
                                leftSection={<IconPlayerPlay size={16} />}
                                onClick={say}
                                loading={asking.isPending}
                                disabled={dialogue ? spokenTurns.length === 0 : text.trim() === ''}
                            >
                                Speak
                            </Button>
                        </Group>
                        {slow && asking.isPending ? (
                            <Alert color="blue" title="Loading the model">
                                A first request, or one for a different variant, loads the model before it speaks. That can take a while, and longer
                                still if its weights have not been downloaded.
                            </Alert>
                        ) : undefined}
                        {asking.isError ? (
                            <ErrorAlert title="That was not spoken" error={asking.error} fallback="The server did not answer." />
                        ) : undefined}
                        {played ? (
                            <Stack gap={4}>
                                <audio
                                    controls
                                    autoPlay
                                    src={played.url}
                                    style={{ width: '100%' }}
                                    aria-label={dialogue ? 'Spoken conversation' : 'Spoken line'}
                                />
                                <Text size="xs" c="dimmed" className="rh-num">
                                    {(played.milliseconds / 1000).toFixed(1)} s to speak, {Math.round(played.bytes / 1024)} KB
                                </Text>
                            </Stack>
                        ) : undefined}
                    </Stack>
                </Card>
            </SimpleGrid>
            <VoicesCard engine={engine} voices={voices} referenceSeconds={referenceSeconds} onCloned={setVoice} />
        </Stack>
    );
}
