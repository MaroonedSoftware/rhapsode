import type { ReactNode } from 'react';
import { Alert } from '@mantine/core';

import { apiErrorMessage } from '../../api/sdk.error';
import { severityColor, type Severity } from './status';

export interface ErrorAlertProps {
    /** What failed, in the page's own words. */
    title?: string;
    /** Whatever was thrown, or a query's `error`. */
    error?: unknown;
    /** The sentence to fall back on when the failure carries no message of its own. */
    fallback?: string;
    tone?: Severity;
    onDismiss?: () => void;
    /** For a caller holding a finished sentence rather than an error. */
    children?: ReactNode;
}

/**
 * Something went wrong, said the same way everywhere: a title the page wrote, then the sentence the
 * CORE wrote, and never one without the other. The core's refusals are written to be read by a
 * person ("management routes answer loopback callers, ..."), so they are shown as they are.
 */
export function ErrorAlert({ title, error, fallback, tone = 'failure', onDismiss, children }: ErrorAlertProps) {
    return (
        <Alert color={severityColor[tone]} title={title} withCloseButton={onDismiss !== undefined} closeButtonLabel="Dismiss" onClose={onDismiss}>
            {children ?? apiErrorMessage(error, fallback ?? '')}
        </Alert>
    );
}
