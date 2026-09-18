/**
 * Every query key in the app, in one place, so an invalidation and the query it means to invalidate
 * cannot drift apart. `as const` tuples, so a typo fails the build rather than silently missing.
 */
export const queryKeys = {
    /** Every engine that exists, and what this box has of it. One key: the core answers all at once. */
    catalog: () => ['catalog'] as const,
    installs: {
        all: () => ['installs'] as const,
        list: () => ['installs', 'list'] as const,
        detail: (id: string) => ['installs', 'detail', id] as const,
    },
} as const;
