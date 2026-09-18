import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The port the core is configured on, read from the same file it reads.
 *
 * `wizard setup` asks for a port and writes it there, so hardcoding the default here sent the proxy
 * to 8080 while the core listened on the port the operator chose, and every /api call was refused.
 */
function configuredPort(): number {
    const path = process.env.RHAPSODE_CONFIG ?? join(REPO, 'rhapsode.config.json');
    try {
        const config = JSON.parse(readFileSync(path, 'utf8')) as { server?: { port?: unknown } };
        if (typeof config.server?.port === 'number') return config.server.port;
    } catch {
        // No config, or one that does not parse: the core then starts on its default too.
    }
    return 8080;
}

// 127.0.0.1 rather than localhost, which can resolve to IPv6 and be refused by a core bound to IPv4.
const API_TARGET = process.env.RHAPSODE_API_TARGET ?? `http://127.0.0.1:${configuredPort()}`;

const api = {
    target: API_TARGET,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
    // Names the browser that asked. The core connects to this server from loopback, and without
    // the header a page opened from another machine would reach the install routes as if it were
    // local. protocol.md § 10.
    xfwd: true,
};

export default defineConfig({
    plugins: [
        // Before react(), so the generated route tree is in place before JSX transforms.
        tanstackRouter({ target: 'react', autoCodeSplitting: true }),
        react(),
    ],
    // Same origin for the page and the core, through the proxy, so the core needs no CORS and a
    // browser's Origin is this server's own, which the core admits as local.
    server: { port: 8081, strictPort: true, proxy: { '/api': api } },
    preview: { port: 8081, strictPort: true, proxy: { '/api': api } },
});
