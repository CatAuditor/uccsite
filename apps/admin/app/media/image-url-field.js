'use client';
// A plain image-path input with an inline upload beside it (Documents
// og:image today). The upload fills the input with the processed variant's
// path; typing a path or URL still works.
import { useState } from 'react';
import InlineImageUpload from './inline-upload';

export default function ImageUrlField({ id, name, defaultValue, targetWidth = 1200, disabled, label = 'Upload an image' }) {
  const [value, setValue] = useState(defaultValue || '');
  return (
    <>
      <input type="text" id={id || name} name={name} value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled} />
      {!disabled && <InlineImageUpload targetWidth={targetWidth} compact label={label} onDone={(path) => setValue(path)} />}
    </>
  );
}
