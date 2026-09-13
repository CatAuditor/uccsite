import { ComingSoon } from '../coming-soon';
import { requireSession } from '../../lib/auth';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireSession();
  return <ComingSoon title="Projects" note="Projects editor lands with the collection-editor batch (Phase 9 adds sorting/filtering)." />;
}
