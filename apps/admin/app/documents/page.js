import { ComingSoon } from '../coming-soon';
import { requireSession } from '../../lib/auth';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requireSession();
  return <ComingSoon title="Documents" note="Long-form Documents (paste-HTML editor plus styling) is Phase 8." />;
}
