import { useState, type ReactNode } from 'react';
import { Badge, Button, Card, Divider, Group, NumberInput, Select, Stack, Switch, TagsInput, Text, TextInput, Title } from '@mantine/core';
import type { Settings, SettingsPatch } from '@maroonedsoftware/rhapsode-sdk';

import { useUpdateSettings } from '../../api/settings.queries';
import { ErrorAlert } from '../shared/error.alert';
import { notifyFailure, notifySuccess } from '../shared/notify';
import { fieldFor, patchOf, same, valueAt, type FieldSpec, type GroupSpec } from './settings.fields';
import { TokenRow } from './token.row';

const LEVELS = ['error', 'warn', 'info', 'debug', 'trace'];

export interface SettingsCardProps {
    group: GroupSpec;
    settings: Settings;
}

/**
 * One group of settings, with its own draft and its own Save.
 *
 * A card saves only the settings in it that were changed, because `PATCH /settings` takes any part of
 * the document and a patch that named everything would write every default into the database, and
 * every setting would then read as set here. Its own mutation, so a refusal is shown in the card whose
 * change it refused.
 */
export function SettingsCard({ group, settings }: SettingsCardProps) {
    const update = useUpdateSettings();
    const [draft, setDraft] = useState<Record<string, unknown>>({});

    const engineFields: FieldSpec[] =
        group.id === 'residency'
            ? Object.keys(settings.values.engines)
                  .sort()
                  .map(id => ({
                      key: `engines.${id}.keepAliveSeconds`,
                      label: id,
                      unit: 'seconds',
                      kind: 'number',
                      help: `Empty uses the ${settings.values.residency.keepAliveSeconds} seconds above.`,
                  }))
            : [];

    const current = (key: string): unknown => valueAt(settings.values, key);
    const changed = Object.keys(draft).filter(key => !same(draft[key], current(key)) && !(draft[key] === null && current(key) === undefined));
    const restart = changed.some(key => fieldFor(settings, key)?.applies === 'restart');

    const send = (patch: SettingsPatch, done: string) =>
        update.mutate(patch, {
            onSuccess: () => {
                setDraft({});
                notifySuccess(done);
            },
        });

    const save = () =>
        send(
            patchOf(Object.fromEntries(changed.map(key => [key, draft[key]]))),
            restart ? 'Saved. It takes effect when rhapsode restarts.' : 'Saved, and in effect now.',
        );

    // Straight away rather than into the draft: an empty field reads as "nothing", not as "whatever
    // the file says", so the page says what it went back to only once the core has answered.
    const reset = (field: FieldSpec) =>
        update.mutate(patchOf({ [field.key]: null }), {
            onSuccess: () =>
                notifySuccess(
                    fieldFor(settings, field.key)?.applies === 'restart'
                        ? `${field.label} goes back to rhapsode.config.json's value, or the default, when rhapsode restarts.`
                        : `${field.label} is back to rhapsode.config.json's value, or the default.`,
                ),
            onError: error => notifyFailure(`${field.label} was not reset`, error),
        });

    const edit = (key: string, value: unknown) => setDraft(previous => ({ ...previous, [key]: value }));
    const shown = (key: string): unknown => (key in draft ? draft[key] : current(key));

    return (
        <Card>
            <Stack gap="md">
                <Stack gap={2}>
                    <Title order={2} size="h4">
                        {group.title}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {group.description}
                    </Text>
                </Stack>

                {group.fields.map(field => (
                    <Row key={field.key} field={field} settings={settings} onReset={() => reset(field)} resetting={update.isPending}>
                        {field.kind === 'token' ? (
                            <TokenRow
                                settings={settings}
                                draft={typeof draft[field.key] === 'string' ? (draft[field.key] as string) : ''}
                                onDraft={value => edit(field.key, value === '' ? undefined : value)}
                                onRemove={() => send(patchOf({ [field.key]: '' }), 'The token is removed when rhapsode restarts.')}
                                removing={update.isPending}
                            />
                        ) : (
                            <Control field={field} value={shown(field.key)} onChange={value => edit(field.key, value)} />
                        )}
                    </Row>
                ))}

                {engineFields.length > 0 ? (
                    <>
                        <Divider label="Each engine" labelPosition="left" />
                        {engineFields.map(field => (
                            <Row key={field.key} field={field} settings={settings} onReset={() => reset(field)} resetting={update.isPending}>
                                <Control field={field} value={shown(field.key)} onChange={value => edit(field.key, value)} />
                            </Row>
                        ))}
                    </>
                ) : undefined}

                {update.isError ? <ErrorAlert title="Nothing was saved" error={update.error} fallback="The server did not answer." /> : undefined}

                <Group justify="flex-end" gap="xs">
                    {changed.length > 0 ? (
                        <Button variant="subtle" onClick={() => setDraft({})} disabled={update.isPending}>
                            Discard
                        </Button>
                    ) : undefined}
                    <Button onClick={save} disabled={changed.length === 0} loading={update.isPending}>
                        Save {group.title.toLowerCase()}
                    </Button>
                </Group>
            </Stack>
        </Card>
    );
}

interface RowProps {
    field: FieldSpec;
    settings: Settings;
    onReset: () => void;
    resetting: boolean;
    children: ReactNode;
}

/** A setting's control, then where its value came from, when a change applies, and what is waiting. */
function Row({ field, settings, onReset, resetting, children }: RowProps) {
    const reported = fieldFor(settings, field.key);
    const waiting = reported?.saved;

    return (
        <Stack gap={6}>
            {children}
            <Group gap="xs" wrap="wrap">
                {reported?.source === 'database' ? (
                    <>
                        <Badge variant="light" size="sm">
                            Set here
                        </Badge>
                        <Button variant="subtle" size="compact-xs" onClick={onReset} disabled={resetting}>
                            Reset
                        </Button>
                    </>
                ) : reported?.source === 'config' ? (
                    <Badge variant="default" size="sm">
                        From rhapsode.config.json
                    </Badge>
                ) : (
                    <Badge variant="default" size="sm" c="dimmed">
                        Default
                    </Badge>
                )}
                {reported?.applies === 'restart' ? (
                    <Badge variant="outline" color="gray" size="sm">
                        Applies at restart
                    </Badge>
                ) : undefined}
                {waiting === undefined ? undefined : (
                    <Badge variant="light" color="yellow" size="sm">
                        {field.kind === 'token' ? 'New token waiting for a restart' : `${describe(waiting)} after a restart`}
                    </Badge>
                )}
            </Group>
        </Stack>
    );
}

interface ControlProps {
    field: FieldSpec;
    value: unknown;
    onChange: (value: unknown) => void;
}

/** An empty field is `null`, which clears the setting when it is saved. */
function Control({ field, value, onChange }: ControlProps) {
    const label = field.unit === undefined ? field.label : `${field.label} (${field.unit})`;
    switch (field.kind) {
        case 'number':
            return (
                <NumberInput
                    label={label}
                    description={field.help}
                    value={typeof value === 'number' ? value : ''}
                    onChange={next => onChange(typeof next === 'number' ? next : null)}
                    allowDecimal={false}
                    className="rh-num"
                    // The input narrow, and its help the width of the card: a number needs a few
                    // characters, and its explanation squeezed to match wrapped to five lines.
                    styles={{ wrapper: { maxWidth: 320 } }}
                />
            );
        case 'switch':
            return (
                <Switch
                    label={field.label}
                    description={field.help}
                    checked={value === true}
                    onChange={event => onChange(event.currentTarget.checked)}
                />
            );
        case 'level':
            return (
                <Select
                    label={field.label}
                    description={field.help}
                    data={LEVELS}
                    value={typeof value === 'string' ? value : null}
                    onChange={next => onChange(next)}
                    allowDeselect={false}
                    styles={{ wrapper: { maxWidth: 320 } }}
                />
            );
        case 'list':
            return (
                <TagsInput
                    label={field.label}
                    description={field.help}
                    value={Array.isArray(value) ? (value as string[]) : []}
                    onChange={next => onChange(next)}
                    placeholder="Type one and press Enter"
                    clearable
                />
            );
        default:
            return (
                <TextInput
                    label={field.label}
                    description={field.help}
                    value={typeof value === 'string' ? value : ''}
                    onChange={event => onChange(event.currentTarget.value === '' ? null : event.currentTarget.value)}
                    spellCheck={false}
                />
            );
    }
}

const describe = (value: unknown): string => (Array.isArray(value) ? (value.length === 0 ? 'none' : value.join(', ')) : String(value));
