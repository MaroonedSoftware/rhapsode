import { notifications } from '@mantine/notifications';

import { apiErrorMessage } from '../../api/sdk.error';

/** Something worked. Short, past tense, and gone by itself. */
export function notifySuccess(message: string): void {
    notifications.show({ color: 'teal', message, autoClose: 3000 });
}

/** Something failed after the dialog that asked for it closed, so there is nowhere else to say it. */
export function notifyFailure(title: string, error: unknown, fallback = 'Nothing was changed.'): void {
    notifications.show({ color: 'red', title, message: apiErrorMessage(error, fallback), autoClose: 6000 });
}
