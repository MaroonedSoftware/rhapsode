import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '../components/settings/settings.page';

// No loader, unlike `/`: a loader refused as `forbidden` would land on the route's error page, and the
// page itself says why a page from another machine cannot see settings.
export const Route = createFileRoute('/settings')({ component: SettingsPage });
