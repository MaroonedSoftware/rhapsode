import type { SdkOptions } from './sdk-options.js';
import { createSdkFetch } from './sdk-options.js';
import { PublicClient } from './public/public.client.js';

export class RhapsodeSdk {
    readonly public: PublicClient;

    constructor(options: SdkOptions) {
        const sdkFetch = options.fetch ?? createSdkFetch(options);
        this.public = new PublicClient(sdkFetch);
    }
}
