/**
 * The one status vocabulary. No surface names a colour for itself: it names a severity, and this
 * table decides the colour, so a warning is the same amber everywhere.
 */
export type Severity = 'failure' | 'warning' | 'success' | 'info';

export const severityColor: Readonly<Record<Severity, string>> = {
    failure: 'red',
    warning: 'yellow',
    success: 'teal',
    info: 'blue',
};
