/**
 * `@rhapsode/core`, if it has been built.
 *
 * The catalog and the defaults live in the core and are not copied here, because a copy is a second
 * place to forget. The price is that they only exist after `pnpm build`, and the doctor has to be
 * able to run before that to say so. So the import is lazy, and a missing build is an answer rather
 * than a crash.
 */
export type Core = typeof import('@rhapsode/core');

export const loadCore = async (): Promise<Core | undefined> => {
    try {
        return await import('@rhapsode/core');
    } catch {
        return undefined;
    }
};
