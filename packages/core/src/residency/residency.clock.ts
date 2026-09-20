import { DateTime } from 'luxon';

/**
 * Time, as the residency manager is allowed to ask about it.
 *
 * Every residency rule worth having is a rule about elapsed time, and against the real clock the
 * only way to assert one is to sleep for it: a suite that covers a five-minute idle expiry honestly
 * takes five minutes, so nobody writes it, which is why `armIdleTimers` shipped untested.
 *
 * `run` returns a promise so that a manual clock can await the transition it just fired. Without
 * that the manager would need a test-only "have the timers finished" hook, and the thing under test
 * would stop being the thing that ships.
 */
export interface ResidencyClock {
    now(): DateTime;
    /** Returns a cancel, which must be safe to call after the work has already run. */
    after(seconds: number, run: () => Promise<void>): () => void;
}

export const systemClock: ResidencyClock = {
    now: () => DateTime.utc(),
    after: (seconds, run) => {
        const timer = setTimeout(() => void run(), seconds * 1000);
        // An idle timer must never be the reason the process is still up: the whole premise of the
        // timer is that nothing is happening.
        timer.unref();
        return () => clearTimeout(timer);
    },
};
