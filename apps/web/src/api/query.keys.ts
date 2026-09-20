/**
 * Every query key in the app, in one place, so an invalidation and the query it means to invalidate
 * cannot drift apart. `as const` tuples, so a typo fails the build rather than silently missing.
 */
export const queryKeys = {
    /** Every engine that exists, and what this box has of it. One key: the core answers all at once. */
    catalog: () => ['catalog'] as const,
    /** What this box has. */
    engines: () => ['engines'] as const,
    /** What is on the card. Polled while the page is open, because a keep-alive expires on its own. */
    residency: () => ['residency'] as const,
    /** Per engine. Capabilities change with the loaded variant, voices with every clone. */
    engine: {
        capabilities: (engine: string) => ['engine', engine, 'capabilities'] as const,
        voices: (engine: string) => ['engine', engine, 'voices'] as const,
    },
    /** The core's OpenAPI document. */
    reference: () => ['reference'] as const,
    installs: {
        all: () => ['installs'] as const,
        list: () => ['installs', 'list'] as const,
        detail: (id: string) => ['installs', 'detail', id] as const,
    },
} as const;
