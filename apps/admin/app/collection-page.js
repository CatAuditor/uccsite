// Server-component factory for list-collection editor pages.
import { revalidatePath } from 'next/cache';
import { requireSession } from '../lib/auth';
import { withDb } from '../lib/data';
import { COLLECTIONS } from '../lib/collections';
import { loadCollectionItems, saveCollection } from '../lib/collection-save';
import { mediaOptionsFor } from '../lib/media';
import ListEditor from './list-editor';

export function makeCollectionPage(...keys) {
  return async function CollectionPage() {
    const session = await requireSession();
    const readOnly = session.role === 'viewer';
    const sections = await withDb(async (client) => {
      const out = [];
      for (const key of keys) {
        const spec = COLLECTIONS[key];
        const mediaOptions = {};
        for (const f of spec.fields) {
          if (f.widget === 'media') mediaOptions[f.name] = await mediaOptionsFor(client, f.targetWidth || 800);
        }
        out.push({ key, spec, items: await loadCollectionItems(client, key), mediaOptions });
      }
      return out;
    });

    return (
      <div>
        {sections.map(({ key, spec, items, mediaOptions }) => {
          async function save(formData) {
            'use server';
            await saveCollection(key, formData);
            revalidatePath('/');
          }
          return (
            <div key={key}>
              <h1>{spec.title}</h1>
              {spec.note && <p className="notice">{spec.note}</p>}
              {readOnly && <p className="notice">Viewer role — read-only.</p>}
              <form className="editor" action={save}>
                <ListEditor
                  fields={spec.fields}
                  items={items}
                  itemLabelField={spec.fields[0].name}
                  readOnly={readOnly}
                  mediaOptions={mediaOptions}
                />
                {!readOnly && <button type="submit">Save {spec.title}</button>}
              </form>
            </div>
          );
        })}
        <p className="notice">Saves change the database only — the live site updates on the next Publish.</p>
      </div>
    );
  };
}
