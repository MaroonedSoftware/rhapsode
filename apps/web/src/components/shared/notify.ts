import { notifications } from '@mantine/notifications';

import { apiErrorMessage } from '../../api/sdk.error';
import { severityColor } from './status';

/** Something worked. Short, past tense, and gone by itself. */
export function notifySuccess(message: string): void {
    notifications.show({ color: severityColor.success, message, autoClose: 3000 });
}

/**
 * Nothing failed, but something was not done and the reader should know why: an engine left alone
 * by a bulk action, an unload refused while the model speaks. Red here would send someone looking
 * for a fault that is not there.
 */
export function notifyInfo(title: string, message: string): void {
    notifications.show({ color: severityColor.info, title, message, autoClose: 6000 });
}

/** Something failed after the dialog that asked for it closed, so there is nowhere else to say it. */
export function notifyFailure(title: string, error: unknown, fallback = 'Nothing was changed.'): void {
    notifications.show({ color: severityColor.failure, title, message: apiErrorMessage(error, fallback), autoClose: 6000 });
}
