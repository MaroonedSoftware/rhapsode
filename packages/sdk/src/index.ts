/**
 * A typed client for the rhapsode public API.
 *
 * Everything under `generated/` is written by `pnpm codegen` from `contracts/rhapsode.public.ck`
 * and committed, so a client of this package never runs a generator. It depends on nothing, because
 * it is what a browser app or another service adopts to talk to a rhapsode, and anything it pulled
 * in would come along.
 *
 * `installJobEvents` returns an async iterable of `FeedEvent`s rather than a body, because a job's
 * event stream does not end on its own. A 403 or 404 arrives as a thrown `SdkError`. protocol.md § 10.
 *
 * `speakStream` is written by hand beside them, because `/speak/stream` is a WebSocket conversation
 * rather than a request and a response. protocol.md § 6.
 */
export * from './generated/index.js';
export * from './speak.stream.js';
