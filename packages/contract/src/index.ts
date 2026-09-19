/**
 * The rhapsode contract: the generated schemas, the standard vocabulary, and the pure functions
 * that apply it.
 *
 * This package depends on zod and nothing else. Keep it that way: it is what a client SDK or a
 * shim adopts on its own, and a server dependency in here would defeat that.
 */

export * from './dispatch.js';
export * from './generated/openapi.document.js';
export * from './generated/rhapsode.openai.schema.js';
export * from './generated/rhapsode.public.schema.js';
export * from './generated/rhapsode.types.schema.js';
export * from './vocabulary.js';
