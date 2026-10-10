import { useEffect, useId, useRef, useState } from 'react';
import {
    Accordion,
    Alert,
    Button,
    Card,
    Group,
    NumberInput,
    SegmentedControl,
    Select,
    SimpleGrid,
    Slider,
    Stack,
    Text,
    Textarea,
    Title,
} from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';
import type { CurrentVariant, EngineSpeakRequest, Variant, Voice } from '@maroonedsoftware/rhapsode-sdk';

import { speakBody, useCapabilities, useDialogue, useSpeak, useVoices, type Spoken } from '../../api/engines.queries';
import { ErrorAlert } from '../shared/error.alert';
import { keyWords } from '../shared/key.words';
import { PageSkeleton } from '../shared/page.skeleton';
import { DialogueEditor, SAMPLE_TURNS, speakerLabel, type EditedTurn } from './dialogue.editor';
import { LineLength } from './line.length';
import { RequestSnippet } from './request.snippet';
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
            voicesPending={voices.isPending}
            voicesError={voices.isError ? voices.error : undefined}
            current={capabilities.data.current}
        />
    );
}

interface ControlsProps {
    engine: string;
    variants: Record<string, Variant>;
    initial: string;
    voices: Voice[];
    /** The list is still on its way, which is not the same as there being none. */
    voicesPending: boolean;
    voicesError?: Error;
    current?: CurrentVariant;
}

function Controls({ engine, variants, initial, voices, voicesPending, voicesError, current }: ControlsProps) {
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
    // The visible headings name the controls under them, so a screen reader hears the same words.
    const ids = { mode: useId(), delivery: useId(), line: useId() };
    const textarea = useRef<HTMLTextAreaElement>(null);

    const claims = variants[variant]!;
    const languages = claims.languages ?? [];
    // A worker from before variants said whether they clone leaves it to `current`, when loaded. § 4.
    const cloning = claims.cloning ?? current?.cloning;
    // The same for blending, which a worker that predates it never claims: absent is no. § 4.
    const blending = (claims.blending ?? current?.blending)?.supported === true;
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

    // One request, for the Speak button and for the snippet that shows it as code.
    const request: EngineSpeakRequest = {
        engine,
        text,
        variant,
        ...(voice === undefined ? {} : { voice }),
        ...(delivery === '' ? {} : { delivery: delivery as EngineSpeakRequest['delivery'] }),
        ...(Object.keys(dials).length === 0 ? {} : { params: dials }),
        ...(language === undefined ? {} : { language }),
        ...(seed === undefined ? {} : { seed }),
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
        speak.mutate(request, settle);
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
                                <Text size="sm" fw={500} id={ids.mode}>
                                    Speak
                                </Text>
                                <SegmentedControl
                                    role="radiogroup"
                                    aria-labelledby={ids.mode}
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
                                <Text size="sm" fw={500} id={ids.delivery}>
                                    Delivery
                                </Text>
                                <SegmentedControl
                                    role="radiogroup"
                                    aria-labelledby={ids.delivery}
                                    data={[
                                        { value: '', label: 'Ordinary' },
                                        ...claims.deliveries.map(entry => ({ value: entry, label: keyWords(entry) })),
                                    ]}
                                    value={delivery}
                                    onChange={setDelivery}
                                />
                            </Stack>
                        ) : undefined}
                        {Object.entries(claims.dials).map(([name, dial]) => (
                            <Stack key={name} gap={4}>
                                <Group justify="space-between">
                                    <Text size="sm" fw={500}>
                                        {keyWords(name)}
                                    </Text>
                                    <Text size="sm" c="dimmed" className="rh-num">
                                        {(dials[name] ?? dial.default).toFixed(2)}
                                    </Text>
                                </Group>
                                <Slider
                                    thumbLabel={keyWords(name)}
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
                        <Title order={2} size="h4" id={ids.line}>
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
                                    aria-labelledby={ids.line}
                                    value={text}
                                    onChange={event => setText(event.currentTarget.value)}
                                    autosize
                                    minRows={4}
                                />
                                <LineLength text={text} variant={variant} claims={claims} current={current} />
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
                            <Alert color="blue" title="Loading the model" role="status">
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
                        {/* The snippet writes a /speak call; a conversation is not one. */}
                        {dialogue ? undefined : (
                            <Accordion variant="contained" radius="md">
                                <Accordion.Item value="code">
                                    <Accordion.Control>
                                        <Text size="sm">As code</Text>
                                    </Accordion.Control>
                                    <Accordion.Panel>
                                        <RequestSnippet body={speakBody(request)} />
                                    </Accordion.Panel>
                                </Accordion.Item>
                            </Accordion>
                        )}
                    </Stack>
                </Card>
            </SimpleGrid>
            <VoicesCard
                engine={engine}
                voices={voices}
                pending={voicesPending}
                error={voicesError}
                cloning={cloning}
                blending={blending}
                onCloned={setVoice}
            />
        </Stack>
    );
}
