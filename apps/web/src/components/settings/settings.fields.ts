import type { Settings, SettingField, SettingsPatch } from '@maroonedsoftware/rhapsode-sdk';

/**
 * What each setting is called on the page and what a person needs to know to change it.
 *
 * Only words live here. Which settings exist, what each is set to, where that came from and whether a
 * change applies now all come from `GET /settings`, and the ranges from the core's refusals, so the
 * page holds no rule the API lacks. A setting the core adds and this file does not name is still
 * shown, under its key. protocol.md § 10, "Settings".
 */

export type FieldKind = 'number' | 'text' | 'switch' | 'level' | 'list' | 'token';

export interface FieldSpec {
    key: string;
    label: string;
    help: string;
    kind: FieldKind;
    /** For a number: what it counts, shown beside it. */
    unit?: string;
}

export interface GroupSpec {
    id: string;
    title: string;
    description: string;
    fields: FieldSpec[];
}

export const GROUPS: GroupSpec[] = [
    {
        id: 'residency',
        title: 'Memory on the card',
        description: 'How many models stay loaded, and for how long. Changes apply at once.',
        fields: [
            {
                key: 'residency.keepAliveSeconds',
                label: 'Keep a model loaded for',
                unit: 'seconds',
                kind: 'number',
                help: 'After its last request. -1 keeps it until something else needs the room; 0 frees it at once. A model that loads slowly earns a longer one below.',
            },
            {
                key: 'residency.maxResidentModels',
                label: 'Models loaded at once',
                kind: 'number',
                help: 'One is right for one GPU. Raising it on a card that cannot hold two turns a queue into an out-of-memory error.',
            },
            {
                key: 'residency.evictionWaitSeconds',
                label: 'Wait for a slot for',
                unit: 'seconds',
                kind: 'number',
                help: 'How long a request for another engine waits for the one speaking to finish before it is told to try again.',
            },
        ],
    },
    {
        id: 'management',
        title: 'Access',
        description: 'Who may install engines and change settings. Changes apply when rhapsode restarts.',
        fields: [
            {
                key: 'management.token',
                label: 'Management token',
                kind: 'token',
                help: 'Admits a caller from any machine that presents it. Installs run pip, so treat it as a root password for this box. Without one, only this machine can manage rhapsode.',
            },
            {
                key: 'management.origins',
                label: 'Pages allowed to manage',
                kind: 'list',
                help: "Web pages, besides this machine's own, that may install engines and change settings, such as http://tower:8081. A page from anywhere else is refused, token or not.",
            },
        ],
    },
    {
        id: 'update',
        title: 'Updates',
        description: 'Applies at once.',
        fields: [
            {
                key: 'update.check',
                label: 'Check for new releases',
                kind: 'switch',
                help: 'At most once a day, only when this page or the wizard asks, sending nothing about this box. RHAPSODE_UPDATE_CHECK=0 in the environment turns it off whatever this says.',
            },
        ],
    },
    {
        id: 'server',
        title: 'Server',
        description: 'Changes apply when rhapsode restarts.',
        fields: [
            {
                key: 'server.port',
                label: 'Port',
                kind: 'number',
                help: 'The port the API listens on. In Docker, leave it at 8080, the port compose publishes.',
            },
            { key: 'server.host', label: 'Address', kind: 'text', help: ':: listens on every interface, 127.0.0.1 on this machine alone.' },
            {
                key: 'server.shutdownGraceMs',
                label: 'Shutdown grace',
                unit: 'ms',
                kind: 'number',
                help: "Comfortably longer than the workers' drain grace, or a correct shutdown looks hung.",
            },
            { key: 'log.level', label: 'Log level', kind: 'level', help: 'How much the server writes to its log.' },
        ],
    },
    {
        id: 'workers',
        title: 'Workers',
        description: 'The processes engines run in. Changes apply when rhapsode restarts.',
        fields: [
            {
                key: 'workers.voiceDir',
                label: 'Voices directory',
                kind: 'text',
                help: 'Where cloned voices are kept, one directory per engine. Changing it moves nothing: move the voices first.',
            },
            {
                key: 'workers.socketDir',
                label: 'Socket directory',
                kind: 'text',
                help: 'Keep it short: a socket path is limited to about 100 bytes.',
            },
            {
                key: 'workers.startupTimeoutSeconds',
                label: 'Start-up timeout',
                unit: 'seconds',
                kind: 'number',
                help: 'How long a worker has to say it is ready.',
            },
            {
                key: 'workers.drainGraceMs',
                label: 'Drain grace',
                unit: 'ms',
                kind: 'number',
                help: 'How long a stopping worker has to finish what it is saying.',
            },
            {
                key: 'workers.maxRestarts',
                label: 'Restarts before giving up',
                kind: 'number',
                help: 'Crashes in a row, after which the engine is left down.',
            },
            {
                key: 'workers.restartDecaySeconds',
                label: 'Crash memory',
                unit: 'seconds',
                kind: 'number',
                help: 'How long a crash counts towards that limit.',
            },
        ],
    },
    {
        id: 'install',
        title: 'Installing engines',
        description: 'Changes apply when rhapsode restarts.',
        fields: [
            {
                key: 'install.venvDir',
                label: 'Virtualenv directory',
                kind: 'text',
                help: 'Where each installed engine gets its own. Changing it moves nothing: an engine runs from where it was installed until it is reinstalled.',
            },
            {
                key: 'install.python',
                label: 'Python',
                kind: 'text',
                help: 'The interpreter that makes each virtualenv: a path, or a version uv can fetch.',
            },
            { key: 'install.sourceDir', label: 'Engine sources', kind: 'text', help: 'Looked in before the package index.' },
        ],
    },
];

/** Every key the page names, to find the ones the core has that it does not. */
const NAMED = new Set(GROUPS.flatMap(group => group.fields.map(field => field.key)));

/** Settings the core reported that no group names: shown anyway, under their keys, rather than hidden. */
export const unnamed = (settings: Settings): FieldSpec[] =>
    settings.fields
        .filter(field => !NAMED.has(field.key) && !field.key.startsWith('engines.'))
        .map(field => ({ key: field.key, label: field.key, help: '', kind: kindOf(valueAt(settings.values, field.key)) }));

const kindOf = (value: unknown): FieldKind =>
    typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'switch' : Array.isArray(value) ? 'list' : 'text';

/** A dotted key's value in the document, or `undefined` where any step of it is missing. */
export const valueAt = (document: unknown, key: string): unknown =>
    key
        .split('.')
        .reduce<unknown>((at, step) => (at !== null && typeof at === 'object' ? (at as Record<string, unknown>)[step] : undefined), document);

export const fieldFor = (settings: Settings, key: string): SettingField | undefined => settings.fields.find(field => field.key === key);

/** Some settings as one patch: `{ 'residency.keepAliveSeconds': 60 }` as `{ residency: { keepAliveSeconds: 60 } }`. */
export function patchOf(changes: Record<string, unknown>): SettingsPatch {
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
        const steps = key.split('.');
        let at = patch;
        for (const step of steps.slice(0, -1)) at = (at[step] ??= {}) as Record<string, unknown>;
        at[steps.at(-1)!] = value;
    }
    return patch as SettingsPatch;
}

/** Whether two values are the same setting, arrays compared by content. */
export const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
