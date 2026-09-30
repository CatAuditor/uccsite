// Development notes: renders docs/dev-notes.md — the plain-language record of
// what was built or changed, which CLAUDE.md requires every code change to
// update. Read-only; every role may see it. The file travels with the code
// (amplify.yml copies it into site-src), so each push refreshes this page.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireSession } from '../../lib/auth';
import { config } from '../../lib/config';
import { renderMarkdown } from '../../lib/mini-markdown.mjs';

export const dynamic = 'force-dynamic';

const INSTRUCTION = `Read docs/dev-notes.md. For every change you make to the site, the admin or the infrastructure, add an entry at the top: a "## YYYY-MM-DD — short title" heading, then what changed and why in plain language for the people running the site, what editors need to do differently, and anything left unfinished. Keep technical detail in docs/changelog.md and docs/systems/. Commit the note with the change.`;

export default async function DevNotesPage() {
  await requireSession();
  let html;
  try {
    html = renderMarkdown(await readFile(join(config.siteSrcRoot, 'docs', 'dev-notes.md'), 'utf8'));
  } catch (err) {
    console.warn(`[admin] dev-notes unreadable: ${err.code || err.name}`);
    html = '<p>The notes file is not in this build. It ships from <code>docs/dev-notes.md</code> on the next push.</p>';
  }
  return (
    <div className="dev-notes">
      <div className="notice">
        <strong>How these notes are written.</strong> Claude adds an entry here with every change, because the
        project instructions (<code>CLAUDE.md</code>) require it. To ask for one explicitly, say:
        <blockquote>{INSTRUCTION}</blockquote>
      </div>
      <article dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
