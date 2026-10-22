import { useState } from 'react';
import { DIFFICULTIES } from '@saloon/shared';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';
import AvatarCropper from './AvatarCropper.jsx';
import { characterSvg } from '../services/characterArt.js';

const MODES = ['ai', 'friends', 'watch'];

export default function JoinScreen() {
  const join = useGameStore((s) => s.join);
  const clearError = useGameStore((s) => s.clearError);
  const enterSpectator = useGameStore((s) => s.enterSpectator);
  const saveProfile = useGameStore((s) => s.saveProfile);
  const locale = useGameStore((s) => s.tutorial.locale);
  const setLocale = useGameStore((s) => s.setLocale);
  const savedName = useGameStore((s) => s.profile.name);
  const avatar = useGameStore((s) => s.avatar);
  const avatarError = useGameStore((s) => s.avatarError);
  const commitAvatar = useGameStore((s) => s.commitAvatar);

  const [name, setName] = useState(null); // null = use the saved name
  const [tableId, setTableId] = useState('main');
  const [mode, setMode] = useState('ai');
  const [difficulty, setDifficulty] = useState('normal');
  const [cropping, setCropping] = useState(false);
  const [busy, setBusy] = useState(false);
  const shownName = name ?? savedName ?? 'Gunslinger';

  const onCommit = async (file, crop, dims) => {
    const meta = await commitAvatar(file, crop, dims);
    if (meta) setCropping(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    clearError();
    setBusy(true);
    const id = tableId.trim() || 'main';
    try {
      if (mode === 'watch') {
        await enterSpectator(id, true);
        return;
      }
      const label = shownName.trim() || 'Player';
      saveProfile({ name: label });
      // Only small metadata travels over the wire; the image stays local.
      const avatarMeta = avatar.id
        ? { avatarId: avatar.id, kind: 'upload', crop: avatar.crop || null }
        : null;
      await join(
        id,
        label,
        mode === 'ai' ? { spawnBot: true, botDifficulty: difficulty, avatarMeta } : { avatarMeta }
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="join" onSubmit={submit}>
      <header className="join__head">
        <h1 className="join__title">{t('app.title')}</h1>
        <p className="join__subtitle">{t('join.subtitle')}</p>
      </header>

      <div className="join__who">
        <div className="join__avatar">
          {avatar.url ? (
            <span
              className="join__avatarimg"
              style={{ backgroundImage: `url("${avatar.url}")` }}
              aria-hidden="true"
            />
          ) : (
            <span
              className="join__avatarimg"
              style={{ backgroundImage: `url("${characterSvg(shownName)}")` }}
              aria-hidden="true"
            />
          )}
          <button type="button" className="linkbtn" onClick={() => setCropping(true)}>
            {avatar.id ? t('join.avatarChange') : t('join.avatarPick')}
          </button>
        </div>
        <label className="field">
          <span>{t('join.name')}</span>
          <input
            value={shownName}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('join.namePlaceholder')}
            maxLength={24}
            required
          />
        </label>
      </div>
      {cropping && <AvatarCropper onCommit={onCommit} onCancel={() => setCropping(false)} />}
      {avatarError && <p className="field__error">{t('avatar.error.generic')}</p>}

      <fieldset className="join__modes">
        <legend>{t('join.howToPlay')}</legend>
        {MODES.map((m) => (
          <label key={m} className={`mode${mode === m ? ' mode--on' : ''}`}>
            <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
            <span className="mode__title">{t(`join.mode.${m}`)}</span>
            <span className="mode__help">{t(`join.mode.${m}.help`)}</span>
          </label>
        ))}
      </fieldset>

      <div className="join__row">
        <label className="field">
          <span>{t('join.table')}</span>
          <input
            value={tableId}
            onChange={(e) => setTableId(e.target.value)}
            placeholder="main"
            maxLength={64}
            required
          />
        </label>
        {mode === 'ai' && (
          <label className="field">
            <span>{t('join.botDifficulty')}</span>
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {t(`difficulty.${d}`)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <button className="btn btn--primary btn--lg join__go" type="submit" disabled={busy}>
        {mode === 'watch' ? t('join.watch') : t('join.takeSeat')}
      </button>

      <footer className="join__foot">
        <p className="note">{t(`join.hint.${mode}`)}</p>
        <label className="join__lang">
          <span>{t('settings.language')}</span>
          <select value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
      </footer>
    </form>
  );
}
