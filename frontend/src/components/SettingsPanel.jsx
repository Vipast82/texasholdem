import { useState } from 'react';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';
import AvatarCropper from './AvatarCropper.jsx';

/**
 * SettingsPanel — Sprint 5 "saloon controls":
 *   - Sound: mute toggle + volume slider (bound to sfxService via the store).
 *   - Avatar: preview + pick/crop a GIF, or reset to the default cowboy.
 * All state lives in the store; this is the thin UI boundary.
 */
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
    <section className="panel settings" aria-label={t('settings.title')}>
      <h2 className="panel__title">{t('settings.title')}</h2>

      {/* Sprint 6 i18n — in-table language toggle (reachable after joining). */}
      <div className="settings__row">
        <label className="settings__language">
          <span>{t('settings.language')}</span>
          <select
            className="settings__languagedrop"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
          >
            <option value="en">EN — English</option>
            <option value="es">ES — Español</option>
          </select>
        </label>
      </div>

      <div className="settings__row">
        <label className="settings__toggle">
          <input
            type="checkbox"
            checked={sfx.muted}
            onChange={(e) => setSfx({ muted: e.target.checked })}
          />
          <span>{t('settings.mute')}</span>
        </label>
        <label className="settings__volume">
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
          <em>{Math.round(sfx.volume * 100)}%</em>
        </label>
      </div>

      <div className="settings__avatar">
        <span className="settings__avatarlabel">{t('settings.avatar')}</span>
        {avatar.url && !cropping && (
          <div className="settings__avatarpreview" style={{ backgroundImage: `url("${avatar.url}")` }} />
        )}
        {!cropping ? (
          <div className="settings__avataractions">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={avatarBusy}
              onClick={() => setCropping(true)}
            >
              {avatar.id ? t('settings.avatarChange') : t('settings.avatarPick')}
            </button>
            {avatar.id && (
              <button type="button" className="btn btn--ghost" disabled={avatarBusy} onClick={() => resetAvatar()}>
                {t('settings.avatarReset')}
              </button>
            )}
          </div>
        ) : (
          <AvatarCropper onCommit={onCommit} onCancel={() => setCropping(false)} />
        )}
        {avatarError && <p className="settings__error">{t('avatar.error.generic')}</p>}
      </div>
    </section>
  );
}