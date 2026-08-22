import { useEffect } from 'react';
import { useGameStore } from './store.js';
import JoinScreen from './components/JoinScreen.jsx';
import Table from './components/Table.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import Controls from './components/Controls.jsx';
import Collapsible from './components/Collapsible.jsx';
import TutorialPanel from './components/TutorialPanel.jsx';
import HandRankingGuide from './components/HandRankingGuide.jsx';
import SpectatorBar from './components/SpectatorBar.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import { t } from './i18n.js';

export default function App() {
  const connected = useGameStore((s) => s.connected);
  const tableId = useGameStore((s) => s.tableId);
  const snapshot = useGameStore((s) => s.snapshot);
  const error = useGameStore((s) => s.error);
  const spectator = useGameStore((s) => s.spectator);
  const locale = useGameStore((s) => s.tutorial.locale);

  // Sprint 6 a11y — keep the document language attribute in sync with the
  // active locale so assistive tech announces the correct language.
  useEffect(() => {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = locale || 'en';
    }
  }, [locale]);

  // Sprint 5: restore the profile (name/avatar) and resolve the local avatar
  // blob from IndexedDB once, on mount. Pure + idempotent; a failure is silent
  // because hydrate never throws (autosave is best-effort).
  useEffect(() => {
    const st = useGameStore.getState();
    if (typeof st.hydrate === 'function') {
      st.hydrate().catch(() => {});
    }
  }, []);

  if (!connected) {
    return (
      <div className="app">
        <div className="status status--offline">{t('app.connecting')}</div>
      </div>
    );
  }

  if (!tableId) {
    return (
      <div className="app">
        {error && <div className="status status--error">{error}</div>}
        <JoinScreen />
        <SettingsPanel />
      </div>
    );
  }

  return (
    <div className="app app--table">
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); const m = document.getElementById('main'); if (m) m.focus(); }}>
        {t('a11y.skipToTable')}
      </a>
      <header className="topbar">
        <span className="topbar__title">{t('app.title')}</span>
        <span className="topbar__meta">{t('app.table', { id: tableId })}</span>
        <button className="btn btn--ghost" onClick={() => useGameStore.getState().leave()}>
          {t('app.leave')}
        </button>
      </header>
      <div className="main" id="main" tabIndex={-1}>
        <div className="main__left">
          {error && <div className="status status--error">{error}</div>}
          {spectator.active && <SpectatorBar />}
          {snapshot && (
            <Collapsible id="tutorial" title={t('tutorial.panel')} showHeader={false}>
              <TutorialPanel />
            </Collapsible>
          )}
          {snapshot && <Table snapshot={snapshot} />}
          {snapshot && !spectator.active && <Controls snapshot={snapshot} />}
        </div>
        <aside className="main__right">
          <Collapsible id="settings" title={t('settings.title')} showHeader={false}>
            <SettingsPanel />
          </Collapsible>
          <Collapsible id="guide" title={t('guide.title')} showHeader={false}>
            <HandRankingGuide />
          </Collapsible>
          <Collapsible id="history" title={t('history.title')} showHeader={false}>
            <HistoryPanel />
          </Collapsible>
          <Collapsible id="chat" title={t('chat.title')} showHeader={false}>
            <ChatPanel />
          </Collapsible>
        </aside>
      </div>
    </div>
  );
}
