import { useState } from 'react';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';
import ChatPanel from './ChatPanel.jsx';
import EmoteBar from './EmoteBar.jsx';
import HistoryPanel from './HistoryPanel.jsx';
import TutorialPanel from './TutorialPanel.jsx';
import HandRankingGuide from './HandRankingGuide.jsx';

const TABS = ['chat', 'history', 'learn'];
const STORAGE_KEY = 'saloon.sideTab';

function readTab() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return TABS.includes(v) ? v : 'chat';
  } catch (err) {
    return 'chat';
  }
}

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
 * The right-hand panel: chat, hand history and the learning tools share one
 * tabbed area so the table keeps most of the screen.
 */
export default function SidePanel() {
  const playerId = useGameStore((s) => s.playerId);
  const chatCount = useGameStore((s) => s.chat.length);
  const [tab, setTab] = useState(readTab);
  const [seenChat, setSeenChat] = useState(chatCount);
  const unread = tab === 'chat' ? 0 : chatCount - seenChat;

  const select = (next) => {
    setTab(next);
    if (next === 'chat' || tab === 'chat') setSeenChat(chatCount);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (err) {
      // a remembered tab is only a convenience
    }
  };

  // Arrow keys move between tabs (standard tablist keyboard pattern).
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : TABS.length - 1;
    const next = TABS[(TABS.indexOf(tab) + step) % TABS.length];
    select(next);
    document.getElementById(`sidetab-${next}`)?.focus();
  };

  return (
    <aside className="side" aria-label={t('side.label')}>
      <div className="side__tabs" role="tablist" aria-label={t('side.label')} onKeyDown={onKeyDown}>
        {TABS.map((name) => (
          <button
            key={name}
            id={`sidetab-${name}`}
            type="button"
            role="tab"
            className="side__tab"
            aria-selected={tab === name}
            aria-controls={`sidepanel-${name}`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => select(name)}
          >
            {t(`side.${name}`)}
            {name === 'chat' && unread > 0 && <span className="side__badge">{unread}</span>}
          </button>
        ))}
      </div>

      {/* All panels stay mounted so the tutorial keeps listening to the game. */}
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
