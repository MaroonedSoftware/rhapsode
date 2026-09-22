import { defineConfig } from 'tsup';

// Merged with the flags in the build script. tsup strips `node:` from imports by default, which is
// harmless for `node:fs` but not for `node:sqlite`: it exists only under the prefix, and the first
// build that bundled the state database imported a package called `sqlite` and failed at boot with
// ERR_MODULE_NOT_FOUND, while every test passed because tests run the source.
export default defineConfig({ removeNodeProtocol: false });
