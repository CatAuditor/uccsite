// Press & coverage (docs/systems/press.md): the one list every story lives
// in. Where a story shows is derived at render from its project, the
// Homepage card tick and the hide-from-news tick.
import { makeCollectionPage } from '../collection-page';
export const dynamic = 'force-dynamic';
export default makeCollectionPage('press');
