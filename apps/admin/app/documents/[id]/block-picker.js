'use client';
// Block picker (docs/systems/document-builder.md "Picker"): a dialog with
// the block types on the left and, on the right, every type rendered with
// the live site stylesheet (the gallery srcdoc from lib/documents.js
// blockGallery). Hovering a type scrolls the gallery to it; clicking either
// side adds that block. Types without a sample (video, coverage, custom
// HTML, byline) are listed with their description only.
import { useEffect, useRef } from 'react';

export default function BlockPicker({ types, gallery, onPick, onClose }) {
  const frame = useRef(null);
  useEffect(() => {
    const onMsg = (e) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.ucc === 'pick' && types[e.data.type]) onPick(e.data.type);
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('message', onMsg);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('message', onMsg); window.removeEventListener('keydown', onKey); };
  }, [types, onPick, onClose]);
  const show = (type) => frame.current?.contentWindow?.postMessage({ ucc: 'show', type }, '*');
  return (
    <div className="picker-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-label="Add a block">
      <div className="picker-dialog">
        <div className="picker-head">
          <strong>Add a block</strong>
          <span className="hint">Hover a type to see it as it will look on the site; click to add it.</span>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="picker-body">
          <div className="picker-types">
            {Object.entries(types).map(([type, d]) => (
              <button type="button" key={type} className="picker-type" onMouseEnter={() => d.sample && show(type)} onFocus={() => d.sample && show(type)} onClick={() => onPick(type)}>
                <strong>{d.label}</strong>
                <span>{d.description}</span>
              </button>
            ))}
          </div>
          <iframe ref={frame} className="picker-gallery" title="Block gallery" sandbox="allow-scripts" srcDoc={gallery} />
        </div>
      </div>
    </div>
  );
}
