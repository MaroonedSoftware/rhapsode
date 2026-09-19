# The web page

How `apps/web` is built and the rules that keep it consistent. The always-loaded index is
[`CLAUDE.md`](../../CLAUDE.md). It is signet's console in miniature, on the same stack and by the same
rules, so that somebody who knows one knows the other.

## What it is for

Two pages over the public API. **Engines** (`/`) is § 10: the catalog, and install, pull and
uninstall with each job followed as it happens. **Try it** (`/try`) is § 6 and § 7: say a line with
an installed engine, offering only what the chosen variant's capability document claims, and list,
preview, clone and delete its voices. The page holds no logic the API lacks and gets no route of
its own. If the page needs something the API does not offer, the API grows it, in the spec first.

**The capability document decides what is offered.** Cues, deliveries, dials and languages come
from the chosen variant and nothing is hardcoded per engine. A new engine appears correctly with
no change here, which is the property § 4 is for. Speak asks for `stream: false`: the page plays a
finished file, and § 6 says a buffered request reports a failure strictly better.

**A preview is played from the `previewUrl` the core gave**, prefixed with `/api`, never a URL the
page builds, with the voice's `spec` in the query so a re-recorded voice is not served from the
browser's cache.

## Design language

**Mantine 9 and nothing else**: no CSS-in-JS, no utility framework. `src/theme.ts` is the whole
palette and every component default, with `rhapsode` (an ink indigo) as the primary colour, and the
colour scheme follows the operating system. `src/tokens.css` holds the `--rh-*` surfaces, for light
and dark alike, and loads after every Mantine stylesheet so it wins.

**Use the shared primitives** in `src/components/shared/`: `PageHeader`, `ErrorAlert`,
`EmptyState`, `PageSkeleton`, `ConfirmModal`, `RouteError`, and `notify.ts`. `status.ts` is the one
status vocabulary, and `components/installs/job.state.ts` the one way a job is named and coloured.
`ErrorAlert` shows the page's title over the sentence the core wrote: the core's refusals are
written for a person, so they are shown as they are.

A link uses `renderRoot={(props: object) => <Link to="..." {...props} />}` and never
`component={Link}`, as in signet. Conditional rendering uses `{cond ? <X /> : undefined}`.

## Talking to the core

**One client, the generated `@maroonedsoftware/rhapsode-sdk`, in `src/api/client.ts`, at `/api`.** The page and the
core share an origin through a proxy (Vite's in development), so the core needs no CORS, and the
page's `Origin` is one the management guard admits. The proxy sets `X-Forwarded-For`, which is how
the core knows a page opened from another machine is remote; keep `xfwd` on.

**The SDK returns a declared refusal as a value.** `unwrap()` in `src/api/sdk.error.ts` turns it
into a rejection, because TanStack Query only knows failure by one. Every call to an operation that
declares refusals goes through it.

**A job's events are read with `EventSource`, not the SDK**, whose method reads the whole body and
cannot return while the stream is open. `src/api/job.feed.ts` folds the events into what the page
draws (the output exists nowhere else) and closes the stream on the job's last event, a `progress`
that is no longer `running`. The core leaves the stream open on purpose.

**Every query key is in `src/api/query.keys.ts`.** A job starting or ending invalidates the catalog
and the job list rather than patching them: the core is their only writer.

## Tests

`tests/setup.ts` supplies what jsdom lacks and Mantine needs. `tests/utils/render.tsx` renders under
the provider stack with a fresh query client per test and `env="test"`. `tests/utils/event.source.ts`
is an `EventSource` a test drives, since jsdom has none. Component tests mock `../src/api/client`
with `vi.hoisted` and assert on what the SDK was asked.

A `beforeEach` takes a block, never a bare expression: vitest runs a function returned from it as a
teardown, and `mock.mockReset()` returns the mock, so the bare form calls it once more after every
test.
