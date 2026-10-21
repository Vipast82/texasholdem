import { useState } from 'react';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';
import AvatarCropper from './AvatarCropper.jsx';

/** Language, sound and table picture. All state lives in the store. */
export default function SettingsPanel() {
  const sfx = useGameStore((s) => s.sfx);
  const setSfx = useGameStore((s) => s.setSfx);
  const avatar = useGameStore((s) => s.avatar);
  const avatarBusy = useGameStore((s) => s.avatarBusy);
  const avatarError = useGameStore((s) => s.avatarError);
  const commitAvatar = useGameStore((s) => s.commitAvatar);
  const resetAvatar = useGameStore((s) => s.resetAvatar);
  const locale = useGameStore((s) => s.tutorial.locale);
  const setLocale = useGameStore((s) => s.setLocale);
  const [cropping, setCropping] = useState(false);

  const onCommit = async (file, crop, dims) => {
    const meta = await commitAvatar(file, crop, dims);
    if (meta) setCropping(false);
  };

  return (
    <section className="settings" aria-label={t('settings.title')}>
      <h2>{t('settings.title')}</h2>

      <label className="field">
        <span>{t('settings.language')}</span>
        <select value={locale} onChange={(e) => setLocale(e.target.value)}>
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
      </label>

      <fieldset className="group">
        <legend>{t('settings.sound')}</legend>
        <label className="toggle">
          <input type="checkbox" checked={sfx.muted} onChange={(e) => setSfx({ muted: e.target.checked })} />
          <span>{t('settings.mute')}</span>
        </label>
        <label className="range">
          <span>{t('settings.volume')}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sfx.volume}
            disabled={sfx.muted}
            onChange={(e) => setSfx({ volume: Number(e.target.value) })}
          />
          <output>{Math.round(sfx.volume * 100)}%</output>
        </label>
      </fieldset>

      <fieldset className="group">
        <legend>{t('settings.avatar')}</legend>
        {cropping ? (
          <AvatarCropper onCommit={onCommit} onCancel={() => setCropping(false)} />
        ) : (
          <div className="settings__avatar">
            {avatar.url ? (
              <span
                className="join__avatarimg"
                style={{ backgroundImage: `url("${avatar.url}")` }}
                aria-hidden="true"
              />
            ) : (
              <span className="join__avatarimg join__avatarimg--empty" aria-hidden="true">
                🤠
              </span>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={avatarBusy}
              onClick={() => setCropping(true)}
            >
              {avatar.id ? t('settings.avatarChange') : t('settings.avatarPick')}
            </button>
            {avatar.id && (
              <button type="button" className="linkbtn" disabled={avatarBusy} onClick={() => resetAvatar()}>
                {t('settings.avatarReset')}
              </button>
            )}
          </div>
        )}
        {avatarError && <p className="field__error">{t('avatar.error.generic')}</p>}
      </fieldset>
    </section>
  );
}
