// The old single-campaign Petition page (before 2026-10-10). Petitions are a
// collection now (docs/systems/petition.md): bookmarks land on the list.
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function OldPetitionPage() {
  redirect('/petitions');
}
