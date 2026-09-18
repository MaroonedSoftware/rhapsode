import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

// The core, on its default port. 127.0.0.1 rather than localhost, which can resolve to IPv6 and be
// refused by a core bound to IPv4 only.
const API_TARGET = process.env.RHAPSODE_API_TARGET ?? 'http://127.0.0.1:8080';

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
