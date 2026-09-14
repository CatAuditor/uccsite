// Tip triage statuses. A 'use server' module may only export async functions,
// so the constant lives here. Imported rows may carry other Airtable values;
// the picker lists those too so they stay selectable.
export const STATUSES = ['New', 'In review', 'Closed'];
