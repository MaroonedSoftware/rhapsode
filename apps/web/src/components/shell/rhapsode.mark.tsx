/** The mark: five bars of a waveform, the same drawing as the favicon. */
export function RhapsodeMark({ size = 28 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="var(--mantine-color-rhapsode-filled)" />
            <path d="M24 24v16M32 16v32M40 22v20M48 29v6M16 29v6" fill="none" stroke="#f4f3ff" strokeWidth="5" strokeLinecap="round" />
        </svg>
    );
}
