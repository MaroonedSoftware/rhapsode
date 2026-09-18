import { Skeleton, Stack } from '@mantine/core';

/**
 * The shapes anything here loads into. Fixed heights, so the placeholder is the size of the thing
 * that replaces it and the layout does not jump when it resolves.
 */
export type SkeletonVariant = 'rows' | 'table' | 'card';

const HEIGHTS: Record<SkeletonVariant, number> = { rows: 28, table: 260, card: 196 };

export interface PageSkeletonProps {
    variant: SkeletonVariant;
    /** Only meaningful for `rows`. */
    count?: number;
}

export function PageSkeleton({ variant, count = 3 }: PageSkeletonProps) {
    if (variant !== 'rows') return <Skeleton height={HEIGHTS[variant]} />;
    return (
        <Stack gap="xs">
            {Array.from({ length: count }, (_, index) => (
                <Skeleton key={index} height={HEIGHTS.rows} />
            ))}
        </Stack>
    );
}
