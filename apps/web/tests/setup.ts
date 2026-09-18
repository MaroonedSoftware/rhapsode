import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

import '@testing-library/jest-dom/vitest';

// Testing Library only self-registers cleanup when vitest runs with `globals: true`, which this
// package does not, so renders would otherwise pile up in one document.
afterEach(cleanup);

// How long `findBy*` and `waitFor` keep retrying. Testing Library's own clock, not vitest's
// `testTimeout`. The default is one second, which a query that resolves in 20ms alone can miss
// under a full workspace run competing for every core. Only the failing path pays the ceiling.
configure({ asyncUtilTimeout: 10_000 });

// jsdom implements none of the browser APIs below, and Mantine uses each of them. Plain functions
// rather than `vi.fn()`, so a test calling `vi.resetAllMocks()` cannot strip their answers.
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    }),
});

// `window.localStorage` is undefined here rather than empty: Node's experimental localStorage global
// takes the name and refuses to work without `--localstorage-file`, so jsdom's never reaches the
// window. Mantine's colour-scheme manager reads it, so it needs one that works.
class MemoryStorage implements Storage {
    private entries = new Map<string, string>();

    get length(): number {
        return this.entries.size;
    }
    key(index: number): string | null {
        return [...this.entries.keys()][index] ?? null;
    }
    getItem(key: string): string | null {
        return this.entries.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        this.entries.set(key, String(value));
    }
    removeItem(key: string): void {
        this.entries.delete(key);
    }
    clear(): void {
        this.entries.clear();
    }
}

Object.defineProperty(window, 'localStorage', { writable: true, configurable: true, value: new MemoryStorage() });

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}

window.ResizeObserver = ResizeObserverStub;

// jsdom does no layout, so scrolling is absent rather than inert. Mantine's `Combobox` (every
// `Select`) keeps the highlighted option in view on a timer that outlives the test, and the throw
// would land as a run-level failure attached to whichever file happened to be running.
Element.prototype.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};

// No font loading API either, and Mantine's autosizing textarea waits on one.
Object.defineProperty(document, 'fonts', {
    writable: true,
    value: { addEventListener: vi.fn(), removeEventListener: vi.fn(), ready: Promise.resolve(), status: 'loaded' },
});
