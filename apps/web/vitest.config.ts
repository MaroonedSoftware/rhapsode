import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tests live in a top-level tests/ folder mirroring src/, importing ../src/...
export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
        include: ['./tests/**/*.test.{ts,tsx}'],
        testTimeout: 20_000,
        hookTimeout: 20_000,
    },
});
