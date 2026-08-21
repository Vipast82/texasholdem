import { useState } from 'react';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';

/**
 * Spectator controls (Sprint 4): visible only when this client is a spectator.
 * Offers the two spectator powers the server authorizes:
 *  - "Show all hole cards" toggle (revealAllHoles is set server-side only).
 *  - "Step" — advances the frozen table one legal move (or starts the next hand).
 */
export default function SpectatorBar() {
  const spectator = useGameStore((s) => s.spectator);
  const setShowAll = useGameStore((s) => s.setShowAll);
  const stepTable = useGameStore((s) => s.stepTable);
  const [stepping, setStepping] = useState(false);

  if (!spectator.active) return null;

  const onStep = async () => {
    if (stepping) return;
    setStepping(true);
    try {
      await stepTable();
    } finally {
      setStepping(false);
    }
  };

  return (
    <div className="spectatorbar" role="toolbar" aria-label={t('spectator.title')}>
      <span className="spectatorbar__label">{t('spectator.title')}</span>
      <label className="spectatorbar__toggle">
        <input
          type="checkbox"
          checked={spectator.showAll}
          onChange={(e) => setShowAll(e.target.checked)}
        />
        <span>{t('spectator.showAll')}</span>
      </label>
      <button
        className="btn btn--action"
        onClick={onStep}
        disabled={stepping}
        title={t('spectator.stepTip')}
      >
        {stepping ? t('spectator.stepBusy') : t('spectator.step')}
      </button>
      <span className="spectatorbar__note">{t('spectator.note')}</span>
    </div>
  );
}