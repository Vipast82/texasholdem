import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';
import { LOOK_OPTIONS, resolveLook, randomLook, characterSvg } from '../services/characterArt.js';
import AvatarCropper from './AvatarCropper.jsx';

const STYLE_KEYS = ['hat', 'hair', 'facial', 'eyes'];
const COLOR_KEYS = ['skin', 'hatColor', 'hairColor', 'shirt', 'bandana', 'backdrop'];

/**
 * Character creator: build your western character (or upload a photo).
 * The look is a handful of small numbers, so it travels with you to every
 * table and other players see exactly what you made.
 */
export default function AvatarCreator({ name, onClose }) {
  const savedLook = useGameStore((s) => s.profile.look);
  const avatar = useGameStore((s) => s.avatar);
  const saveLook = useGameStore((s) => s.setLook);
  const commitAvatar = useGameStore((s) => s.commitAvatar);
  const [look, setLook] = useState(() => resolveLook(name, savedLook));
  const [uploading, setUploading] = useState(false);
  const dialogRef = useRef(null);

  // Focus the dialog on open and close it with Escape.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (dialogRef.current) dialogRef.current.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = (key, value) => setLook((l) => ({ ...l, [key]: value }));
  const save = async () => {
    await saveLook(look);
    onClose();
  };
  const onUpload = async (file, crop, dims) => {
    const meta = await commitAvatar(file, crop, dims);
    if (meta) onClose();
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="creator-title">
      <div className="creator" ref={dialogRef} tabIndex={-1}>
        <h2 id="creator-title" className="creator__title">
          {t('creator.title')}
        </h2>

        {uploading ? (
          <AvatarCropper onCommit={onUpload} onCancel={() => setUploading(false)} />
        ) : (
          <>
            <div className="creator__body">
              <div className="creator__preview">
                <img
                  src={characterSvg(name, 'normal', look)}
                  alt={t('creator.preview')}
                  width="168"
                  height="168"
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setLook(randomLook(name))}
                >
                  {t('creator.random')}
                </button>
              </div>
              <div className="creator__rows">
                {STYLE_KEYS.map((key) => (
                  <div key={key} className="creator__row" role="radiogroup" aria-label={t(`creator.${key}`)}>
                    <span className="choice__label">{t(`creator.${key}`)}</span>
                    <div className="choice__opts">
                      {LOOK_OPTIONS[key].map((opt, i) => (
                        <button
                          key={opt}
                          type="button"
                          role="radio"
                          aria-checked={look[key] === i}
                          className={`choice__opt${look[key] === i ? ' choice__opt--on' : ''}`}
                          onClick={() => pick(key, i)}
                        >
                          {t(`creator.${key}.${opt}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {COLOR_KEYS.map((key) => (
                  <div key={key} className="creator__row" role="radiogroup" aria-label={t(`creator.${key}`)}>
                    <span className="choice__label">{t(`creator.${key}`)}</span>
                    <div className="swatches">
                      {LOOK_OPTIONS[key].map((color, i) => (
                        <button
                          key={color}
                          type="button"
                          role="radio"
                          aria-checked={look[key] === i}
                          aria-label={
                            color === 'none' ? t('creator.none') : `${t(`creator.${key}`)} ${i + 1}`
                          }
                          className={`swatch${look[key] === i ? ' swatch--on' : ''}${color === 'none' ? ' swatch--none' : ''}`}
                          style={color === 'none' ? undefined : { background: color }}
                          onClick={() => pick(key, i)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="creator__actions">
              <button type="button" className="linkbtn" onClick={() => setUploading(true)}>
                {avatar.id ? t('creator.changePhoto') : t('creator.usePhoto')}
              </button>
              <span className="creator__spacer" />
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                {t('creator.cancel')}
              </button>
              <button type="button" className="btn btn--primary" onClick={save}>
                {t('creator.save')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
