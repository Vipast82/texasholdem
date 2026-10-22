import { useState } from 'react';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';
import { FELTS } from '../services/autosave.js';
import { avatarPreviewSrc } from '../services/characterArt.js';
import AvatarCreator from './AvatarCreator.jsx';

const FELT_SWATCH = {
  green: '#1d6044',
  blue: '#1d4a72',
  red: '#70241d',
  purple: '#4a2b66',
  black: '#262624'
};

function VolumeRow({ label, value, disabled, onChange }) {
  return (
    <label className="range">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{Math.round(value * 100)}%</output>
    </label>
  );
}

/** Language, sound, table appearance and your character. */
export default function SettingsPanel() {
  const sfx = useGameStore((s) => s.sfx);
  const setSfx = useGameStore((s) => s.setSfx);
  const avatar = useGameStore((s) => s.avatar);
  const avatarBusy = useGameStore((s) => s.avatarBusy);
  const avatarError = useGameStore((s) => s.avatarError);
  const resetAvatar = useGameStore((s) => s.resetAvatar);
  const locale = useGameStore((s) => s.tutorial.locale);
  const setLocale = useGameStore((s) => s.setLocale);
  const settings = useGameStore((s) => s.profile.settings);
  const look = useGameStore((s) => s.profile.look);
  const setAppearance = useGameStore((s) => s.setAppearance);
  const playerName = useGameStore((s) => s.name || s.profile.name || 'Gunslinger');
  const [editing, setEditing] = useState(false);

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
        <VolumeRow
          label={t('settings.effects')}
          value={sfx.volume}
          disabled={sfx.muted}
          onChange={(v) => setSfx({ volume: v })}
        />
        <VolumeRow
          label={t('settings.voices')}
          value={sfx.voiceVolume}
          disabled={sfx.muted}
          onChange={(v) => setSfx({ voiceVolume: v })}
        />
        <label className="toggle">
          <input type="checkbox" checked={sfx.music} onChange={(e) => setSfx({ music: e.target.checked })} />
          <span>{t('settings.music')}</span>
        </label>
        <VolumeRow
          label={t('settings.musicVolume')}
          value={sfx.musicVolume}
          disabled={sfx.muted || !sfx.music}
          onChange={(v) => setSfx({ musicVolume: v })}
        />
        <label className="toggle">
          <input type="checkbox" checked={sfx.talk} onChange={(e) => setSfx({ talk: e.target.checked })} />
          <span>
            {t('settings.talk')}
            <small>{t('settings.talkHelp')}</small>
          </span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={sfx.dealerCalls}
            onChange={(e) => setSfx({ dealerCalls: e.target.checked })}
          />
          <span>
            {t('settings.dealerCalls')}
            <small>{t('settings.dealerCallsHelp')}</small>
          </span>
        </label>
      </fieldset>

      <fieldset className="group">
        <legend>{t('settings.table')}</legend>
        <div className="creator__row" role="radiogroup" aria-label={t('settings.felt')}>
          <span className="choice__label">{t('settings.felt')}</span>
          <div className="swatches">
            {FELTS.map((felt) => (
              <button
                key={felt}
                type="button"
                role="radio"
                aria-checked={settings.felt === felt}
                aria-label={t(`settings.felt.${felt}`)}
                title={t(`settings.felt.${felt}`)}
                className={`swatch${settings.felt === felt ? ' swatch--on' : ''}`}
                style={{ background: FELT_SWATCH[felt] }}
                onClick={() => setAppearance({ felt })}
              />
            ))}
          </div>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.fourColor}
            onChange={(e) => setAppearance({ fourColor: e.target.checked })}
          />
          <span>
            {t('settings.fourColor')}
            <small>{t('settings.fourColorHelp')}</small>
          </span>
        </label>
      </fieldset>

      <fieldset className="group">
        <legend>{t('settings.avatar')}</legend>
        <div className="settings__avatar">
          <span
            className="join__avatarimg"
            style={{ backgroundImage: `url("${avatar.url || avatarPreviewSrc(playerName, look)}")` }}
            aria-hidden="true"
          />
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={avatarBusy}
            onClick={() => setEditing(true)}
          >
            {t('creator.edit')}
          </button>
          {avatar.id && (
            <button type="button" className="linkbtn" disabled={avatarBusy} onClick={() => resetAvatar()}>
              {t('settings.avatarReset')}
            </button>
          )}
        </div>
        {avatarError && <p className="field__error">{t('avatar.error.generic')}</p>}
      </fieldset>
      {editing && <AvatarCreator name={playerName} onClose={() => setEditing(false)} />}
    </section>
  );
}
