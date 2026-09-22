import { Alert, List, Stack } from '@mantine/core';

import { useSettings } from '../../api/settings.queries';
import { apiErrorCode } from '../../api/sdk.error';
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
                        <SettingsCard key={group.id} group={group} settings={settings.data} />
                    ))}
                    {others.length > 0 ? (
                        <SettingsCard
                            group={{ id: 'other', title: 'Other', description: 'Settings this page has no words for yet.', fields: others }}
                            settings={settings.data}
                        />
                    ) : undefined}
                </>
            )}
        </Stack>
    );
}
