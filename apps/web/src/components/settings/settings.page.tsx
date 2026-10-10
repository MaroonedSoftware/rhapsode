import { useCallback, useState } from 'react';
import { Alert, List, Stack } from '@mantine/core';
import { useBlocker } from '@tanstack/react-router';

import { useSettings } from '../../api/settings.queries';
import { apiErrorCode } from '../../api/sdk.error';
import { ConfirmModal } from '../shared/confirm.modal';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { severityColor } from '../shared/status';
import { GROUPS, unnamed } from './settings.fields';
import { SettingsCard } from './settings.card';

/**
 * How this rhapsode runs, and the means to change it. protocol.md § 10, "Settings".
 *
 * A client of `GET` and `PATCH /settings` and nothing else, as `pnpm wizard settings` is. What each
 * setting is, where its value came from and when a change applies are the core's answers; the page
 * adds only words.
 */
export function SettingsPage() {
    const settings = useSettings();
    // Every card keeps its own draft, so leaving the page dropped a change typed into one without a
    // word. The cards report whether they hold one, and the page asks before it goes.
    const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set());
    const onDirty = useCallback(
        (group: string, isDirty: boolean) =>
            setDirty(current => {
                if (current.has(group) === isDirty) return current;
                const next = new Set(current);
                if (isDirty) next.add(group);
                else next.delete(group);
                return next;
            }),
        [],
    );
    const blocker = useBlocker({ shouldBlockFn: () => dirty.size > 0, enableBeforeUnload: () => dirty.size > 0, withResolver: true });

    // Reading is a management route too, so a page opened from another machine without its origin
    // listed is refused before it sees anything. That is the whole answer, said once, as the Engines
    // page says it for installs.
    const forbidden = settings.isError && apiErrorCode(settings.error) === 'forbidden';
    const labels = new Map(GROUPS.flatMap(group => group.fields.map(field => [field.key, field.label] as const)));
    const waiting = settings.data?.fields.filter(field => field.saved !== undefined) ?? [];
    const others = settings.data === undefined ? [] : unnamed(settings.data);

    return (
        <Stack gap="lg">
            <PageHeader
                title="Settings"
                description="How this rhapsode runs. A change is kept by the server, over rhapsode.config.json, which is left as it is."
            />

            {waiting.length > 0 ? (
                <Alert color={severityColor.warning} title={`${waiting.length} change${waiting.length === 1 ? '' : 's'} waiting for a restart`}>
                    <List size="sm">
                        {waiting.map(field => (
                            <List.Item key={field.key}>{labels.get(field.key) ?? field.key}</List.Item>
                        ))}
                    </List>
                </Alert>
            ) : undefined}

            {settings.isPending ? (
                <PageSkeleton variant="card" />
            ) : forbidden ? (
                <ErrorAlert tone="info" title="Settings are only for the machine running rhapsode" error={settings.error} />
            ) : settings.isError ? (
                <ErrorAlert title="The settings did not load" error={settings.error} fallback="The rhapsode server did not answer." />
            ) : (
                <>
                    {GROUPS.map(group => (
                        <SettingsCard key={group.id} group={group} settings={settings.data} onDirty={onDirty} />
                    ))}
                    {others.length > 0 ? (
                        <SettingsCard
                            group={{ id: 'other', title: 'Other', description: 'Settings this page has no words for yet.', fields: others }}
                            settings={settings.data}
                            onDirty={onDirty}
                        />
                    ) : undefined}
                </>
            )}

            <ConfirmModal
                opened={blocker.status === 'blocked'}
                onClose={() => blocker.reset?.()}
                onConfirm={() => blocker.proceed?.()}
                title="Leave without saving?"
                confirmLabel="Leave"
            >
                {`What was changed in ${[...dirty].map(id => GROUPS.find(group => group.id === id)?.title ?? 'Other').join(' and ')} has not been saved, and is lost if you leave.`}
            </ConfirmModal>
        </Stack>
    );
}
