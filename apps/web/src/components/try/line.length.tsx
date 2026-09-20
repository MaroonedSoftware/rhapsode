import { Alert, Text } from '@mantine/core';
import type { CurrentVariant, Variant } from '@maroonedsoftware/rhapsode-sdk';

/**
 * How long the line is, against what this build will take and what it says at a time.
 *
 * The split is a thing a client cannot see and is affected by (protocol.md § 8), so the page says it
 * before the request rather than leaving somebody to wonder why a paragraph came back seamed. The
 * ceiling is here for the same reason: the core refuses a long line with a sentence, and finding
 * that out by pressing Speak costs a round trip and the wait for a model to load.
 */
export interface LineLengthProps {
    text: string;
    variant: string;
    claims: Variant;
    current?: CurrentVariant;
}

export function LineLength({ text, variant, claims, current }: LineLengthProps) {
    // The build's own ceiling where it overrides one, and the resident build's only when that is
    // this build: a ceiling read off another is a guess, and § 4 exists so the page does not guess.
    const ceiling = claims.maxCharacters ?? (variant === current?.variant ? current.maxCharacters : undefined);
    // A worker from before § 8 declares nothing, which is not the same as declaring no. § 4.
    const segmentation = claims.segmentation ?? (variant === current?.variant ? current.segmentation : undefined);
    const piece = segmentation?.supported === true ? segmentation.segmentCharacters : undefined;

    // `text.length`, because that is what the core counts when it decides to refuse.
    const length = text.length;
    const counted = `${length.toLocaleString()} character${length === 1 ? '' : 's'}`;

    if (ceiling !== undefined && length > ceiling) {
        return (
            <Alert color="yellow" title="Longer than this build takes">
                {counted}, and this build accepts {ceiling.toLocaleString()}. The server refuses the line rather than speaking part of it.
            </Alert>
        );
    }

    return (
        <Text size="xs" c="dimmed" className="rh-num">
            {counted}
            {ceiling === undefined ? '' : ` of ${ceiling.toLocaleString()}`}
            {piece !== undefined && length > piece
                ? `. Spoken ${piece.toLocaleString()} at a time, broken where a reader would pause and joined into one take.`
                : ''}
        </Text>
    );
}
