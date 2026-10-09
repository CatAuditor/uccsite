// Server-component factory for list-collection editor pages.
import { revalidatePath } from 'next/cache';
import { requireSession } from '../lib/auth';
import { withDb } from '../lib/data';
import { COLLECTIONS } from '../lib/collections';
import { loadCollectionItems, loadCollectionBaseline, saveCollection } from '../lib/collection-save';
import { mediaOptionsFor } from '../lib/media';
import { listProjects } from '../lib/files';
import { runAction } from '../lib/actions';
import ListEditor from './list-editor';
import ActionForm from './action-form';
import RequestPublish from './request-publish';

export function makeCollectionPage(...keys) {
  return async function CollectionPage() {
    const session = await requireSession();
    const readOnly = session.role === 'viewer';
    const sections = await withDb(async (client) => {
      const out = [];
      for (const key of keys) {
        const spec = COLLECTIONS[key];
        const mediaOptions = {};
        const selectOptions = {};
        for (const f of spec.fields) {
          if (f.widget === 'media') mediaOptions[f.name] = await mediaOptionsFor(client, f.targetWidth || 800);
          // optionsFrom 'projects': the tree in order, sub-projects indented (lib/files.js listProjects).
          if (f.optionsFrom === 'projects') selectOptions[f.name] = (await listProjects(client)).map(p => ({ value: p.slug, label: p.label }));
        }
        out.push({
          key, spec, mediaOptions, selectOptions,
          items: await loadCollectionItems(client, key),
          baseline: await loadCollectionBaseline(client, key),
        });
      }
      return out;
    });

    return (
      <div>
        {sections.map(({ key, spec, items, mediaOptions, selectOptions, baseline }) => {
          async function save(prevState, formData) {
            'use server';
            return runAction(async () => {
              await saveCollection(key, formData);
              revalidatePath('/');
            });
          }
          return (
            <div key={key}>
              <h1>{spec.title}</h1>
              {spec.note && <p className="notice">{spec.note}</p>}
              {readOnly && <p className="notice">Viewer role — read-only.</p>}
              <ActionForm className="editor" action={save} successMessage={`${spec.title} saved. Publish to make it live.`}>
                <input type="hidden" name="baseline" value={baseline} />
                <ListEditor
                  fields={spec.fields}
                  items={items}
                  itemLabelField={spec.fields[0].name}
                  readOnly={readOnly}
                  mediaOptions={mediaOptions}
                  selectOptions={selectOptions}
                  sortable={Boolean(spec.nested || spec.sortable)}
                />
                {!readOnly && <><button type="submit">Save {spec.title}</button><RequestPublish /></>}
              </ActionForm>
            </div>
          );
        })}
        <p className="notice">Save keeps this as a draft in the database. It goes live when a publish request is approved on Publish &amp; Status — nothing to rebuild by hand.</p>
      </div>
    );
  };
}
