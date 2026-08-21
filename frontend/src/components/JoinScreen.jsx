import { useState } from 'react';
import { DIFFICULTIES } from '@saloon/shared';
import { useGameStore } from '../store.js';
import { t, setLocale } from '../i18n.js';
import AvatarCropper from './AvatarCropper.jsx';

export default function JoinScreen() {
  const join = useGameStore((s) => s.join);
  const clearError = useGameStore((s) => s.clearError);
  const enterSpectator = useGameStore((s) => s.enterSpectator);
  const tutorial = useGameStore((s) => s.tutorial);
  const avatar = useGameStore((s) => s.avatar);
  const avatarError = useGameStore((s) => s.avatarError);
  const [name, setName] = useState('Gunslinger');
  const [tableId, setTableId] = useState('main');
  const [vsAI, setVsAI] = useState(false);
  const [spectate, setSpectate] = useState(false);
  const [difficulty, setDifficulty] = useState('normal');
  const [cropping, setCropping] = useState(false);

  const commitAvatar = useGameStore((s) => s.commitAvatar);
  const onCommit = async (file, crop, dims) => {
    const meta = await commitAvatar(file, crop, dims);
    if (meta) setCropping(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    clearError();
    const id = tableId.trim() || 'main';
    if (spectate) {
      // Watch the table without taking a seat (all cards revealed, step-through).
      await enterSpectator(id, true);
      return;
    }
    const label = name.trim() || 'Player';
    // Only small metadata travels over the wire (privacy). The blob stays local.
    const avatarMeta = avatar.id
      ? { avatarId: avatar.id, kind: 'upload', crop: avatar.crop || null }
      : null;
    if (vsAI) {
      // Ask the server to seat an AI opponent at the table so the human plays
      // a real hand against a bot (server-side). The human keeps a human seat.
      await join(id, label, { spawnBot: true, botDifficulty: difficulty, avatarMeta });
      return;
    }
    await join(id, label, { avatarMeta });
  };

  return (
    <form className="join" onSubmit={submit}>
      <h1 className="join__title">{t('join.title')}</h1>
      <p className="join__subtitle">{t('join.subtitle')}</p>
      <label className="field">
        <span>{t('join.name')}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('join.namePlaceholder')}
          maxLength={24}
          required
        />
      </label>

      <div className="join__avatar">
        <span className="join__avatarlabel">{t('join.avatar')}</span>
        {avatar.url && !cropping && (
          <div className="join__avatarpreview" style={{ backgroundImage: `url("${avatar.url}")` }} />
        )}
        {!cropping ? (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setCropping(true)}
          >
            {avatar.id ? t('join.avatarChange') : t('join.avatarPick')}
          </button>
        ) : (
          <AvatarCropper onCommit={onCommit} onCancel={() => setCropping(false)} />
        )}
        {avatarError && <p className="join__hint join__hint--error">{t('avatar.error.generic')}</p>}
      </div>

      <label className="field">
        <span>{t('join.table')}</span>
        <input
          value={tableId}
          onChange={(e) => setTableId(e.target.value)}
          placeholder="main"
          required
        />
      </label>
      <label className="field field--toggle">
        <input
          type="checkbox"
          checked={vsAI}
          onChange={(e) => setVsAI(e.target.checked)}
        />
        <span>{t('join.vsAI')}</span>
      </label>
      {vsAI && (
        <label className="field">
          <span>{t('join.botDifficulty')}</span>
          <select
            className="field__select"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {t(`difficulty.${d}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field field--toggle">
        <input
          type="checkbox"
          checked={spectate}
          onChange={(e) => setSpectate(e.target.checked)}
        />
        <span>{t('join.spectate')}</span>
      </label>
      {spectate && <p className="join__hint">{t('join.spectateHint')}</p>}
      <label className="field">
        <span>{t('settings.language')}</span>
        <select
          className="field__select"
          value={tutorial.locale}
          onChange={(e) => {
            useGameStore.getState().setLocale(e.target.value);
            setLocale(e.target.value);
          }}
        >
          <option value="en">EN</option>
          <option value="es">ES</option>
        </select>
      </label>
      <button className="btn btn--primary" type="submit">
        {t('join.takeSeat')}
      </button>
      <p className="join__hint">{t('join.hint')}</p>
    </form>
  );
}
