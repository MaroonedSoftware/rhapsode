import { ActionIcon, Button, Group, Select, Stack, Text, Textarea, Tooltip } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type { Voice } from '@maroonedsoftware/rhapsode-sdk';

/** One line of a conversation as the page edits it: a speaker's number and what they say. */
export interface EditedTurn {
    speaker: number;
    text: string;
}

export const SAMPLE_TURNS: EditedTurn[] = [
    { speaker: 1, text: 'Did you hear that? [gasp]' },
    { speaker: 2, text: '[laugh] It is only the cat.' },
    { speaker: 1, text: 'It is never only the cat.' },
];

/** What a speaker is called in the request. The core only needs the same label for the same person. */
export const speakerLabel = (speaker: number) => `speaker${speaker}`;

export interface DialogueEditorProps {
    turns: EditedTurn[];
    onTurns: (turns: EditedTurn[]) => void;
    /** Speaker number to voice id, for the speakers given one. */
    voices: Record<number, string>;
    onVoices: (voices: Record<number, string>) => void;
    /** From the variant's `dialogue`, so the page offers no speaker it would refuse. § 4. */
    maxSpeakers: number;
    engineVoices: Voice[];
    cues: string[];
}

/** A conversation's turns, and a voice for each speaker. Only offered where the variant declares one. */
export function DialogueEditor({ turns, onTurns, voices, onVoices, maxSpeakers, engineVoices, cues }: DialogueEditorProps) {
    const speakers = Array.from({ length: maxSpeakers }, (_, index) => index + 1);
    const change = (index: number, turn: Partial<EditedTurn>) => onTurns(turns.map((entry, at) => (at === index ? { ...entry, ...turn } : entry)));
    // The next turn goes to whoever did not speak last, which is what a conversation usually does.
    const next = () => {
        const last = turns.at(-1)?.speaker ?? maxSpeakers;
        onTurns([...turns, { speaker: (last % maxSpeakers) + 1, text: '' }]);
    };

    return (
        <Stack gap="md">
            <Group grow align="flex-start">
                {speakers.map(speaker => (
                    <Select
                        key={speaker}
                        label={`Speaker ${speaker}'s voice`}
                        placeholder="One the engine picks"
                        data={engineVoices.map(entry => ({ value: entry.id, label: entry.label }))}
                        value={voices[speaker] ?? null}
                        onChange={value => {
                            const rest = Object.fromEntries(Object.entries(voices).filter(([key]) => Number(key) !== speaker));
                            onVoices(value === null ? rest : { ...rest, [speaker]: value });
                        }}
                        clearable
                    />
                ))}
            </Group>
            {turns.map((turn, index) => (
                <Group key={index} align="flex-start" wrap="nowrap" gap="xs">
                    <Select
                        aria-label={`Turn ${index + 1} speaker`}
                        data={speakers.map(speaker => ({ value: String(speaker), label: `Speaker ${speaker}` }))}
                        value={String(turn.speaker)}
                        onChange={value => value && change(index, { speaker: Number(value) })}
                        allowDeselect={false}
                        w={130}
                    />
                    <Textarea
                        aria-label={`Turn ${index + 1}`}
                        value={turn.text}
                        onChange={event => change(index, { text: event.currentTarget.value })}
                        autosize
                        minRows={1}
                        style={{ flex: 1 }}
                    />
                    <Tooltip label="Remove this turn">
                        <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Remove turn ${index + 1}`}
                            disabled={turns.length === 1}
                            onClick={() => onTurns(turns.filter((_, at) => at !== index))}
                            mt={6}
                        >
                            <IconTrash size={14} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
            ))}
            <Group justify="space-between">
                <Button variant="light" size="compact-sm" leftSection={<IconPlus size={14} />} onClick={next}>
                    Add a turn
                </Button>
                <Text size="xs" c="dimmed">
                    {cues.length > 0 ? `Cues such as [${cues[0]}] go in the text.` : 'This variant performs no cues.'}
                </Text>
            </Group>
        </Stack>
    );
}
