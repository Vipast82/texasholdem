import { useCallback, useEffect, useRef, useState } from 'react';
import { computeSquareCrop, clamp } from '../services/cropUtils.js';
import { validateAvatarFile, ACCEPTED_TYPES, MAX_AVATAR_BYTES } from '../services/avatarStore.js';
import { cropCss } from '../services/avatarView.js';
import { t } from '../i18n.js';

/**
 * AvatarCropper — pick a GIF avatar and choose a square region of it to use as
 * the round avatar. The source never leaves the component: we keep the File in
 * memory and the crop rect in state, and call `onCommit(file, crop, dims)` when
 * the user confirms (the store then stores the blob in IndexedDB).
 *
 *   - Validation: GIF only, hard cap 20 MB (reuses avatarStore's pure rules).
 *   - Crop: drag to pan, slider/wheel to zoom, all via computeSquareCrop (the
 *     pure, unit-tested math). The preview is a CSS `background` that frames the
 *     exact same square the canvas crop will produce.
 *   - Output: `onCommit(file, crop, dims)` where crop={x,y,size,w,h} in source
 *     px and dims={w,h} is the full source image.
 */
export default function AvatarCropper({ onCommit, onCancel }) {
  const [file, setFile] = useState(null);
  const [srcUrl, setSrcUrl] = useState(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [crop, setCrop] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: null, y: null });
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);
  const previewRef = useRef(null);
  const rootRef = useRef(null);
  const openerRef = useRef(null);
  // Always call the latest onCancel from the long-lived Escape listener.
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  // Sprint 6 a11y — focus management: move focus into the dialog on open,
  // restore it to the opener on close/cancel, and close on Escape.
  useEffect(() => {
    openerRef.current = document.activeElement;
    const target =
      (rootRef.current && rootRef.current.querySelector('.cropper__file')) ||
      (rootRef.current && rootRef.current.querySelector('button, input'));
    if (target && typeof target.focus === 'function') target.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancelRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const opener = openerRef.current;
      if (opener && document.contains(opener) && typeof opener.focus === 'function') {
        opener.focus();
      }
    };
  }, []);

  // Revoke the object URL on change/unmount (best-effort).
  useEffect(() => {
    return () => {
      if (srcUrl) {
        try {
          URL.revokeObjectURL(srcUrl);
        } catch (err) {
          /* noop */
        }
      }
    };
  }, [srcUrl]);

  const loadFile = useCallback((f) => {
    if (!f) return;
    const v = validateAvatarFile(f);
    if (!v.ok) {
      setError(v.code);
      return;
    }
    setError(null);
    setFile(f);
    const url = URL.createObjectURL(f);
    setSrcUrl(url);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 1;
      const h = img.naturalHeight || 1;
      setDims({ w, h });
      setZoom(1);
      setCenter({ x: null, y: null });
      setCrop(computeSquareCrop({ imageW: w, imageH: h, zoom: 1 }));
    };
    img.onerror = () => {
      setError('decode');
      setDims({ w: 0, h: 0 });
      setCrop(null);
    };
    img.src = url;
  }, []);

  const onInput = (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadFile(f);
    e.target.value = ''; // allow re-selecting the same file
  };

  const recompute = (z, cx, cy) => {
    if (!dims.w || !dims.h) return;
    setCrop(computeSquareCrop({ imageW: dims.w, imageH: dims.h, zoom: z, cx, cy }));
  };

  const startDrag = (e) => {
    if (!crop) return;
    e.preventDefault();
    setDragging(true);
    dragRef.current = { x: e.clientX, y: e.clientY };
  };
  const moveDrag = (e) => {
    if (!dragging || !dims.w || !dims.h) return;
    const start = dragRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const el = previewRef.current;
    const px = el ? el.clientWidth : 120;
    const scale = crop.size / Math.max(1, px) || 1;
    const cx = (center.x == null ? dims.w / 2 : center.x) + dx * scale;
    const cy = (center.y == null ? dims.h / 2 : center.y) + dy * scale;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setCenter({ x: cx, y: cy });
    recompute(zoom, cx, cy);
  };
  const endDrag = () => {
    setDragging(false);
    dragRef.current = null;
  };

  const onWheel = (e) => {
    if (!dims.w) return;
    e.preventDefault();
    const nz = clamp(zoom * (e.deltaY > 0 ? 0.9 : 1.1), 1, Math.max(1, Math.min(dims.w, dims.h)));
    setZoom(nz);
    recompute(nz, center.x, center.y);
  };

  // CSS that frames the crop window in the (square) preview element — identical
  // framing to SeatAvatar/cropCss so what you see here is what other seats see.
  let previewStyle = null;
  if (srcUrl && crop && dims.w && dims.h) {
    previewStyle = {
      backgroundImage: `url("${srcUrl}")`,
      backgroundRepeat: 'no-repeat',
      ...cropCss(crop, dims.w, dims.h)
    };
  }

  const commit = () => {
    if (file && crop && dims.w) {
      onCommit(file, crop, { w: dims.w, h: dims.h });
    }
  };

  return (
    <div className="cropper" role="dialog" aria-modal="true" aria-label={t('creator.usePhoto')} ref={rootRef}>
      <div className="cropper__preview" onWheel={onWheel}>
        <div
          ref={previewRef}
          className={`cropper__img ${dragging ? 'cropper__img--drag' : ''}`}
          style={previewStyle || undefined}
          onMouseDown={startDrag}
          onMouseMove={moveDrag}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        >
          <div className="cropper__ring" aria-hidden="true" />
        </div>
        <input
          className="cropper__file"
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          aria-label={t('creator.usePhoto')}
          onChange={onInput}
        />
      </div>

      <label className="cropper__zoom">
        <span>{t('avatar.zoom')}</span>
        <input
          type="range"
          min={1}
          max={8}
          step={0.1}
          value={Math.min(8, Math.round(zoom * 10) / 10)}
          onChange={(e) => {
            const nz = Number(e.target.value);
            setZoom(nz);
            recompute(nz, center.x, center.y);
          }}
          disabled={!crop}
        />
      </label>

      {error && <p className="cropper__error">{t(`avatar.error.${error}`)}</p>}
      <p className="cropper__hint">
        {t('avatar.limit', {
          type: ACCEPTED_TYPES.join(' '),
          max: `${Math.round(MAX_AVATAR_BYTES / 1024 / 1024)}MB`
        })}
      </p>

      <div className="cropper__actions">
        <button type="button" className="btn btn--primary" onClick={commit} disabled={!file || !crop}>
          {t('avatar.save')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          {t('avatar.cancel')}
        </button>
      </div>
    </div>
  );
}
