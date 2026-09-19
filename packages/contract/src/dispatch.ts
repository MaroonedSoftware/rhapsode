/**
 * Turning a request the client wrote into the request this variant can actually be asked. § 5, § 6.
 *
 * Writing and speaking are different moments, and only the dispatcher knows which variant is about
 * to be asked, which is why these rules live in the core rather than in a client.
 */

import type { Dial, Variant } from './generated/rhapsode.types.schema.js';
import { withoutCues } from './vocabulary.js';

/** What a variant claims it can do, in the shape the capability document reports it. */
export interface Claims {
    cues: string[];
    deliveries: string[];
    dials: Record<string, Dial>;
    maxCharacters?: number;
    /** Present only where the variant answers `/dialogue`. § 4. */
    dialogue?: { maxSpeakers: number };
}

/** A refusal that names what was wrong and what to send instead. */
export class DispatchError extends Error {
    constructor(
        readonly code: 'bad_request' | 'unsupported',
        message: string,
    ) {
        super(message);
        this.name = 'DispatchError';
    }
}

/**
 * The effective variant: what this request is actually about. protocol.md § 4, as amended.
 *
 * The request's own choice, then whatever is loaded, then the engine's default. Total, which
 * `current` is not, because `current` is absent while nothing is resident.
 *
 * A variant the request named and the engine does not have is **refused**, and the order matters: a
 * fallback here would produce audio the caller did not ask for and has no way to notice. Only an
 * absent variant falls back.
 */
export function effectiveVariant(
    requested: string | undefined,
    declared: Record<string, Variant>,
    options: { loaded?: string; fallback?: string } = {},
): string {
    const names = Object.keys(declared);
    if (names.length === 0) throw new DispatchError('unsupported', 'this engine declares no variants');

    if (requested !== undefined) {
        if (!(requested in declared)) {
            throw new DispatchError('unsupported', `no variant "${requested}"; this engine has ${names.join(', ')}`);
        }
        return requested;
    }

    for (const candidate of [options.loaded, options.fallback]) {
        if (candidate !== undefined && candidate in declared) return candidate;
    }
    return names[0]!;
}

/**
 * Refuse an unknown dial, and say what the variant does have. protocol.md § 6.
 *
 * The tempting alternative is to ignore it, and it is wrong for the same reason a silently discarded
 * dial is wrong: the client believes it asked for something. A `400` naming the key is a bug report
 * delivered to the right person in under a second, but only if the message says what to send
 * instead. Chatterbox `turbo`, whose dials are empty where `original` has two, is the case that
 * makes that pay.
 */
export function assertKnownDials(params: Record<string, number> | undefined, dials: Record<string, Dial>, variant: string): Record<string, number> {
    if (params === undefined) return {};

    const known = Object.keys(dials);
    for (const [key, value] of Object.entries(params)) {
        const dial = dials[key];
        if (dial === undefined) {
            throw new DispatchError(
                'bad_request',
                `variant "${variant}" has no dial "${key}"; it has ${known.length > 0 ? known.sort().join(', ') : 'none'}`,
            );
        }
        if (!Number.isFinite(value)) {
            throw new DispatchError('bad_request', `dial "${key}" takes a number`);
        }
        if (value < dial.min || value > dial.max) {
            throw new DispatchError('bad_request', `dial "${key}" is ${value} and takes ${dial.min} to ${dial.max}`);
        }
    }
    return { ...params };
}

/** What a request becomes once the variant it is going to has had its say. */
export interface Performable {
    text: string;
    delivery?: string;
    params: Record<string, number>;
    dropped: { cues: string[]; delivery?: string };
}

/**
 * Apply every vocabulary rule, in the order the protocol puts them in.
 *
 * Cues the variant does not claim come out of the text, a delivery it did not claim is dropped, and
 * an unknown dial is refused. The first two are silent by design: the core is making the request
 * performable rather than arguing with a client that asked for something reasonable. The third is
 * not, because an unknown dial is a mistake rather than a capability gap.
 */
export function performable(
    request: { text: string; delivery?: string; params?: Record<string, number> },
    claims: Claims,
    variant: string,
): Performable {
    const asked = new Set(request.text.match(/\[([^\]]+)\]/g) ?? []);
    const text = withoutCues(request.text, claims.cues);
    const kept = new Set(text.match(/\[([^\]]+)\]/g) ?? []);

    const deliveryClaimed = request.delivery !== undefined && claims.deliveries.includes(request.delivery);

    return {
        text,
        delivery: deliveryClaimed ? request.delivery : undefined,
        params: assertKnownDials(request.params, claims.dials, variant),
        dropped: {
            cues: [...asked].filter(cue => !kept.has(cue)),
            delivery: request.delivery !== undefined && !deliveryClaimed ? request.delivery : undefined,
        },
    };
}

/**
 * Refuse text longer than the variant will take. protocol.md § 6.
 *
 * Checked in the core as well as in the SDK because a `400` here is a round trip cheaper and does
 * not need a worker to be running at all.
 */
export function assertWithinCeiling(text: string, claims: Claims, fallback: number): void {
    const ceiling = claims.maxCharacters ?? fallback;
    if (text.length > ceiling) {
        throw new DispatchError('bad_request', `\`text\` is ${text.length} characters and this variant accepts ${ceiling}`);
    }
}

/** One speaker's line, as a dialogue request carries it. § 6. */
export interface Turn {
    speaker: string;
    text: string;
}

/** What a dialogue becomes once the variant it is going to has had its say. */
export interface PerformableDialogue {
    turns: Turn[];
    params: Record<string, number>;
    dropped: { cues: string[] };
}

/**
 * `performable` for a conversation. protocol.md § 6.
 *
 * Refuses a variant that does not declare `dialogue`, more speakers than it takes, and a dialogue
 * over the ceiling, which is the sum of every turn's text: one take is one budget. Cues come out of
 * each turn as they would out of `/speak`'s text. There is no delivery to drop, because a dialogue
 * has none.
 */
export function performableDialogue(
    request: { turns: Turn[]; params?: Record<string, number> },
    claims: Claims,
    variant: string,
    fallbackCeiling: number,
): PerformableDialogue {
    if (claims.dialogue === undefined) {
        throw new DispatchError('unsupported', `variant "${variant}" does not speak dialogue`);
    }
    if (request.turns.length === 0) throw new DispatchError('bad_request', '`turns` must have at least one turn');

    const speakers = new Set(request.turns.map(turn => turn.speaker));
    if (speakers.size > claims.dialogue.maxSpeakers) {
        throw new DispatchError(
            'unsupported',
            `this dialogue has ${speakers.size} speakers and variant "${variant}" takes ${claims.dialogue.maxSpeakers}`,
        );
    }

    const ceiling = claims.maxCharacters ?? fallbackCeiling;
    const length = request.turns.reduce((sum, turn) => sum + turn.text.length, 0);
    if (length > ceiling) {
        throw new DispatchError('bad_request', `the turns come to ${length} characters and this variant accepts ${ceiling}`);
    }

    const dropped = new Set<string>();
    const turns = request.turns.map(turn => {
        const ready = performable({ text: turn.text }, claims, variant);
        ready.dropped.cues.forEach(cue => dropped.add(cue));
        return { speaker: turn.speaker, text: ready.text };
    });

    return { turns, params: assertKnownDials(request.params, claims.dials, variant), dropped: { cues: [...dropped] } };
}
