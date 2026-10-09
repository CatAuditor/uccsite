// Which hero is the homepage showing? Two answers, side by side, so an
// editor can SEE a change took effect instead of guessing:
//   draft — what this database would render on the next publish
//           (petition takeover while an OPEN petition is ticked "featured"
//            on Petitions, the standing hero otherwise — templates/index.html)
//   live  — what the public homepage serves RIGHT NOW, read from the page
//           itself (the hero <section> carries `hero-petition` in takeover
//           mode). Fetched fresh on every admin page view, never cached.
// docs/systems/petition.md "Verifying the hero".
import { config } from './config';

const FETCH_TIMEOUT_MS = 5000;

// draftHero(homepage, petitions) — petitions: the rows from listPetitions.
export function draftHero(homepage, petitions = []) {
  const featured = (petitions || []).find(p => String(p.status || '') === 'open' && String(p.featured || '') === '1');
  const headline = String(featured?.headline ?? '').trim();
  return featured
    ? { mode: 'petition', label: `Petition takeover (${featured.slug})`, detail: headline.replace(/<[^>]+>/g, '') }
    : { mode: 'standing', label: 'Standing hero (the default)', detail: String(homepage?.hero?.headline ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() };
}

export async function liveHero() {
  const origin = config.publicOrigin;
  try {
    const res = await fetch(`${origin}/?admin-hero-check=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'User-Agent': 'UCC-Admin-HeroCheck' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { mode: 'unknown', label: `Could not read the live homepage (HTTP ${res.status})`, origin };
    const html = (await res.text()).slice(0, 200_000);
    const m = html.match(/<section class="hero([^"]*)"/);
    if (!m) return { mode: 'unknown', label: 'Could not find the hero on the live homepage', origin };
    const petition = /\bhero-petition\b/.test(m[1]);
    const h1 = html.match(/<h1 class="hero-headline[^"]*">([\s\S]*?)<\/h1>/);
    const detail = h1 ? h1[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
    return petition
      ? { mode: 'petition', label: 'Petition takeover', detail, origin }
      : { mode: 'standing', label: 'Standing hero (the default)', detail, origin };
  } catch (err) {
    console.warn(`[admin] live hero check failed: ${err?.name || 'Error'}`);
    return { mode: 'unknown', label: 'Could not reach the live homepage', origin };
  }
}

// Server component: the status block both editors render.
export function HeroStatus({ draft, live }) {
  const same = draft.mode === live.mode;
  return (
    <section className={`hero-status ${same ? 'in-sync' : live.mode === 'unknown' ? 'unknown' : 'out-of-sync'}`}>
      <h2>Which hero is showing?</h2>
      <table>
        <tbody>
          <tr>
            <th>Live site right now</th>
            <td><strong>{live.label}</strong>{live.detail ? <div className="hint">“{live.detail}”</div> : null}
              <div className="hint"><a href={live.origin} target="_blank" rel="noopener">{live.origin}</a> — read just now</div></td>
          </tr>
          <tr>
            <th>Saved in this admin (next publish)</th>
            <td><strong>{draft.label}</strong>{draft.detail ? <div className="hint">“{draft.detail}”</div> : null}</td>
          </tr>
        </tbody>
      </table>
      <p className="hint">
        {live.mode === 'unknown'
          ? 'The live check failed this time; reload to retry. The saved state above is still accurate.'
          : same
            ? 'In sync — the live site shows what is saved here.'
            : 'Not published yet — the live site will switch to the saved hero after the next approved publish.'}
        {' '}Rule: the petition hero shows while an open petition is ticked <strong>Show in the homepage hero</strong> on Petitions; untick it (or close the petition) and the standing hero returns by itself.
      </p>
    </section>
  );
}
