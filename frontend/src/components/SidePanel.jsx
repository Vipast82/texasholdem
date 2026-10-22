import { useEffect } from 'react';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';
import ChatPanel from './ChatPanel.jsx';
import EmoteBar from './EmoteBar.jsx';
import HistoryPanel from './HistoryPanel.jsx';
import TutorialPanel from './TutorialPanel.jsx';
import HandRankingGuide from './HandRankingGuide.jsx';
import { CloseIcon } from './Icons.jsx';

export const SIDE_TABS = ['chat', 'history', 'learn'];

function OddsToggle() {
  const hud = useGameStore((s) => s.hud);
  const toggleHud = useGameStore((s) => s.toggleHud);
  return (
    <label className="toggle">
      <input type="checkbox" checked={hud.enabled} onChange={toggleHud} />
      <span>
        <strong>{t('hud.label')}</strong>
        <small>{t('hud.help')}</small>
      </span>
    </label>
  );
}

/**
 * Slide-out drawer holding chat, hand history and the learning tools, so the
 * table can use the whole screen. It stays mounted while closed so the
 * tutorial keeps listening to the game.
 */
export default function SidePanel({ open, tab, onTab, onClose }) {
  const playerId = useGameStore((s) => s.playerId);

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Arrow keys move between tabs (standard tablist keyboard pattern).
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : SIDE_TABS.length - 1;
    const next = SIDE_TABS[(SIDE_TABS.indexOf(tab) + step) % SIDE_TABS.length];
    onTab(next);
    document.getElementById(`sidetab-${next}`)?.focus();
  };

  return (
    <aside
      className={`side${open ? ' side--open' : ''}`}
      aria-label={t('side.label')}
      inert={open ? undefined : true}
    >
      <div className="side__head">
        <div className="side__tabs" role="tablist" aria-label={t('side.label')} onKeyDown={onKeyDown}>
          {SIDE_TABS.map((name) => (
            <button
              key={name}
              id={`sidetab-${name}`}
              type="button"
              role="tab"
              className="side__tab"
              aria-selected={tab === name}
              aria-controls={`sidepanel-${name}`}
              tabIndex={tab === name ? 0 : -1}
              onClick={() => onTab(name)}
            >
              {t(`side.${name}`)}
            </button>
          ))}
        </div>
        <button type="button" className="iconbtn" onClick={onClose} aria-label={t('side.close')}>
          <CloseIcon />
        </button>
      </div>

      <div
        className="side__body"
        role="tabpanel"
        id="sidepanel-chat"
        aria-labelledby="sidetab-chat"
        hidden={tab !== 'chat'}
      >
        {playerId && <EmoteBar playerId={playerId} />}
        <ChatPanel />
      </div>
      <div
        className="side__body"
        role="tabpanel"
        id="sidepanel-history"
        aria-labelledby="sidetab-history"
        hidden={tab !== 'history'}
      >
        <HistoryPanel />
      </div>
      <div
        className="side__body learn"
        role="tabpanel"
        id="sidepanel-learn"
        aria-labelledby="sidetab-learn"
        hidden={tab !== 'learn'}
      >
        <OddsToggle />
        <TutorialPanel />
        <HandRankingGuide />
      </div>
    </aside>
  );
}
