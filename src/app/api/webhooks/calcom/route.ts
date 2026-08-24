// Backwards-compatible plural path for providers configured with the common
// `/webhooks/*` convention. Both paths share the exact signed handler.
export { POST } from '../../webhook/calcom/route';

// Next.js only recognizes route configuration when it is declared literally
// in this module; re-exporting these constants silently falls back to defaults.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
