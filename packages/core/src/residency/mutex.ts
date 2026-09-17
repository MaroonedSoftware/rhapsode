/**
 * A promise chain, which is all a transition lock needs to be.
 *
 * It is held across any residency transition and never during synthesis. That distinction is the
 * whole point: two concurrent requests for the same cold model produce one load, and neither of
 * them blocks anybody else while the audio is being made.
 */
export class Mutex {
    private tail: Promise<void> = Promise.resolve();

    async run<T>(work: () => Promise<T>): Promise<T> {
        const previous = this.tail;
        let release!: () => void;
        this.tail = new Promise<void>(fulfil => {
            release = fulfil;
        });

        await previous;
        try {
            return await work();
        } finally {
            release();
        }
    }
}
