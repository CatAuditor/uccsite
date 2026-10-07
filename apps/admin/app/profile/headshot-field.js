'use client';
// Headshot field on /profile: the path input + Media Library datalist, with
// an inline upload that fills the input when the image is ready.
import { useState } from 'react';
import InlineImageUpload from '../media/inline-upload';

export default function HeadshotField({ name, defaultValue, options, targetWidth }) {
  const [value, setValue] = useState(defaultValue || '');
  const listId = `${name}-options`;
  return (
    <>
      <input type="text" id={name} name={name} value={value} onChange={(e) => setValue(e.target.value)} list={listId} />
      <datalist id={listId}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</datalist>
      <InlineImageUpload targetWidth={targetWidth} crop={1} label="Upload a new headshot" compact onDone={(path) => setValue(path)} />
      <div className="hint">Pick a Media Library image (only images with alt text are offered), upload a new one here, or keep the current path.</div>
    </>
  );
}
