import { redirect } from 'next/navigation';

/**
 * Property setup moved into Configuration (owner brief, 2026-09-26): the hotel profile, its room
 * types, rate types and rate plans each have a section there. Old links land on Room types —
 * what this page was mostly used for. Guided pricing setup stays at `/app/setup/smart`.
 */
export default function SetupRedirect() {
  redirect('/app/configuration/room-types');
}
