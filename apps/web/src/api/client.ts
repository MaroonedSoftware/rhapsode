import { RhapsodeSdk } from '@maroonedsoftware/rhapsode-sdk';

/**
 * The page is served from the same origin as the core, through Vite's proxy in development and a
 * reverse proxy in production, so a relative prefix is enough and the core needs no CORS.
 */
export const BASE_URL = '/api';

/** The one client. Nothing else in the app calls fetch against the core. */
export const sdk = new RhapsodeSdk({ baseUrl: BASE_URL });
