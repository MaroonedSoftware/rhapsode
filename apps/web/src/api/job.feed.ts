import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { FeedEvent, FeedProgress } from '@rhapsode/sdk';

import { BASE_URL } from './client';
import { invalidateAfterJob } from './installs.queries';
import { queryKeys } from './query.keys';

/** Output lines kept on screen. An install of Chatterbox prints a few hundred; the tail is what explains a failure. */
const KEPT_LINES = 400;

export interface JobFeed {
    /** The step the job last reported, and whether it finished. */
    progress?: FeedProgress;
    /** What pip and the interpreter printed, oldest first, capped. */
    lines: string[];
    /** Whether the stream is open. It closes itself once the job's last event has arrived. */
    live: boolean;
}

/**
 * One job's events, from `GET /installs/{job}/events`, folded into what the page draws.
 *
 * Folded, unlike kanban's feed, which only invalidates: an install's output lines exist nowhere
 * but the stream, so there is nothing to refetch them from. The job's own state is still read from
 * the core, and is refetched once the stream says the job has ended.
 *
 * A plain `EventSource`, not the SDK, whose method reads the whole body and so cannot return while
 * the stream is open. It reconnects on its own and resumes from `Last-Event-ID`, which the core
 * honours, so a dropped connection loses no lines. The stream stays open after the job ends, by
 * design (a server-closed stream makes `EventSource` reconnect forever), so this closes it on the
 * last event: a `progress` whose status is no longer `running`. protocol.md § 10.
 */
export function useJobFeed(jobId: string | undefined): JobFeed {
    const queryClient = useQueryClient();
    // Tagged with the job it belongs to, so a change of job reads as empty until the new stream
    // speaks, rather than an effect resetting state and rendering twice to say nothing.
    const [feed, setFeed] = useState<TaggedFeed>({ ...EMPTY, jobId: undefined });

    useEffect(() => {
        if (jobId === undefined) return;
        const update = (change: (current: JobFeed) => Partial<JobFeed>) =>
            setFeed(previous => {
                const current = previous.jobId === jobId ? previous : { ...EMPTY, jobId };
                return { ...current, ...change(current), jobId };
            });

        const source = new EventSource(`${BASE_URL}/installs/${encodeURIComponent(jobId)}/events`);
        source.onopen = () => update(() => ({ live: true }));
        source.onerror = () => update(() => ({ live: false }));

        source.addEventListener('server.feed', message => {
            const event = readEvent((message as MessageEvent<string>).data);
            if (event === undefined) return;

            if (event.kind === 'log' && event.message !== undefined) {
                const line = event.message;
                update(current => ({ lines: [...current.lines, line].slice(-KEPT_LINES) }));
            } else if (event.kind === 'progress' && event.progress !== undefined) {
                const progress = event.progress;
                const ended = progress.status !== 'running';
                update(() => ({ progress, ...(ended ? { live: false } : {}) }));
                if (ended) {
                    source.close();
                    void invalidateAfterJob(queryClient);
                    void queryClient.invalidateQueries({ queryKey: queryKeys.installs.detail(jobId) });
                }
            }
        });

        // The resume point fell out of the core's buffer. The lines in between are gone; the job's
        // own state is not, so read it again.
        source.addEventListener('resync', () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.installs.detail(jobId) });
        });

        return () => source.close();
    }, [jobId, queryClient]);

    return feed.jobId === jobId ? feed : EMPTY;
}

type TaggedFeed = JobFeed & { jobId: string | undefined };

const EMPTY: JobFeed = { lines: [], live: false };

/**
 * A frame's data as a feed event, or undefined for one this page cannot read.
 *
 * Checked by hand rather than with the contract's zod schema, which would bring zod into the bundle
 * for the two fields this reads. An unreadable frame is skipped rather than thrown: one bad line of
 * output is not a reason to stop following the install.
 */
export function readEvent(data: string): FeedEvent | undefined {
    try {
        const parsed: unknown = JSON.parse(data);
        if (typeof parsed !== 'object' || parsed === null) return undefined;
        const event = parsed as Partial<FeedEvent>;
        return typeof event.kind === 'string' && typeof event.id === 'number' ? (event as FeedEvent) : undefined;
    } catch {
        return undefined;
    }
}
