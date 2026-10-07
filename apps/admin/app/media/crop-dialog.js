'use client';
// Fit-to-frame crop step for image fields that render in a fixed frame
// (docs/systems/media.md "Inline upload" → "Crop step"). The editor drags and
// zooms the picture inside a frame of the field's aspect ratio (1 = square
// headshot), exactly like a social-media profile photo picker, and only the
// framed region is uploaded. The site's CSS `object-fit: cover` then shows
// the whole upload instead of a blind centre crop. Pure client-side: the
// original file never leaves the browser; onDone receives a JPEG File.
import { useCallback, useEffect, useState } from 'react';
import Cropper from 'react-easy-crop';

const MAX_SIDE = 1600; // px — enough for every variant the Lambda makes

export default function CropDialog({ file, aspect = 1, onDone, onCancel }) {
  const [src, setSrc] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onCropComplete = useCallback((_, pixels) => setArea(pixels), []);

  async function finish() {
    if (!area) return;
    setBusy(true);
    try {
      const img = await loadImage(src);
      const scale = Math.min(1, MAX_SIDE / Math.max(area.width, area.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(area.width * scale);
      canvas.height = Math.round(area.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // PNG transparency → white, not black, in the JPEG
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the cropped image'))), 'image/jpeg', 0.92));
      const base = file.name.replace(/\.[^.]+$/, '') || 'image';
      onDone(new File([blob], `${base}.jpg`, { type: 'image/jpeg' }));
    } catch (err) {
      console.error('[media] crop failed', err);
      setError(err.message || String(err));
      setBusy(false);
    }
  }

  return (
    <div className="crop-overlay" role="dialog" aria-modal="true" aria-label="Fit the picture to the frame">
      <div className="crop-dialog">
        <div className="crop-stage">
          {src && (
            <Cropper image={src} crop={crop} zoom={zoom} aspect={aspect} minZoom={1} maxZoom={4}
              onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete}
              onMediaLoaded={() => setError('')}
              mediaProps={{ onError: () => setError('This browser cannot open that image. Try a JPEG or PNG.') }} />
          )}
        </div>
        <label className="crop-zoom">Zoom
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
        </label>
        <div className="hint">Drag to move, pinch or use the slider to zoom. What is inside the frame is what gets uploaded.</div>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="crop-actions">
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" onClick={finish} disabled={busy || !area || Boolean(error)}>{busy ? 'Cropping…' : 'Use this crop'}</button>
        </div>
      </div>
    </div>
  );
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the image'));
    img.src = src;
  });
}
