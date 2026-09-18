/**
 * A typed client for the rhapsode public API.
 *
 * Everything under `generated/` is written by `pnpm codegen` from `contracts/rhapsode.public.ck`
 * and committed, so a client of this package never runs a generator. It depends on nothing, because
 * it is what a browser app or another service adopts to talk to a rhapsode, and anything it pulled
 * in would come along.
 *
 * One operation it cannot serve is `installJobEvents`: the generated method reads the whole body,
 * and a job's event stream does not end on its own. Read it with an `EventSource` on
 * `/installs/{job}/events` instead. protocol.md § 10.
 */
export * from './generated/index.js';
