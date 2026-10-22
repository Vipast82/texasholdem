import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from './store.js';
import JoinScreen from './components/JoinScreen.jsx';
import Table from './components/Table.jsx';
import Controls from './components/Controls.jsx';
import SidePanel from './components/SidePanel.jsx';
import SpectatorBar from './components/SpectatorBar.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import { ChatIcon, GearIcon, SoundIcon, ExitIcon, HistoryIcon, BookIcon } from './components/Icons.jsx';
import { describeHand } from './handStrength.js';
import { t } from './i18n.js';

function SettingsDialog({ dialogRef }) {
  return (
    <dialog ref={dialogRef} className="dialog" aria-label={t('settings.title')}>
      <SettingsPanel />
      <form method="dialog" className="dialog__actions">
        <button className="btn btn--primary" type="submit">
          {t('settings.done')}
        </button>
      </form>
    </dialog>
  );
}

function ErrorBar({ error }) {
  const clearError = useGameStore((s) => s.clearError);
  if (!error) return null;
  return (
    <div className="errorbar" role="alert">
      <span>{error}</span>
      <button type="button" className="errorbar__close" onClick={clearError} aria-label={t('app.dismiss')}>
        ×
      </button>
    </div>
  );
}

function IconButton({ label, onClick, children, badge }) {
  return (
    <button type="button" className="iconbtn" onClick={onClick} aria-label={label} title={label}>
      {children}
      {badge > 0 && <span className="iconbtn__badge">{badge}</span>}
    </button>
  );
}

/** Bottom-left readout of the best hand you currently hold. */
function HandReadout({ snapshot, playerId, locale }) {
  const me = snapshot && snapshot.players.find((p) => p.id === playerId);
  const live = me && !me.hasFolded && (me.status === 'in-hand' || snapshot.street === 'ended');
  const text = live ? describeHand(me.holeCards, snapshot.community, locale) : null;
  return (
    <div className="hudbar__box hudbar__hand">
      <span className="hudbar__label">{t('hud.hand')}</span>
      <strong>{text || t('hud.noHand')}</strong>
    </div>
  );
}

export default function App() {
  const connected = useGameStore((s) => s.connected);
  const tableId = useGameStore((s) => s.tableId);
  const playerId = useGameStore((s) => s.playerId);
  const snapshot = useGameStore((s) => s.snapshot);
  const error = useGameStore((s) => s.error);
  const spectator = useGameStore((s) => s.spectator);
  const locale = useGameStore((s) => s.tutorial.locale);
  const chatCount = useGameStore((s) => s.chat.length);
  const sfx = useGameStore((s) => s.sfx);
  const setSfx = useGameStore((s) => s.setSfx);
  const leave = useGameStore((s) => s.leave);
  const settingsRef = useRef(null);

  const [drawer, setDrawer] = useState({ open: false, tab: 'chat' });
  const [seenChat, setSeenChat] = useState(0);
  const chatVisible = drawer.open && drawer.tab === 'chat';
  // Anything posted while the chat is on screen counts as read.
  if (chatVisible && seenChat !== chatCount) setSeenChat(chatCount);
  const unread = chatVisible ? 0 : Math.max(0, chatCount - seenChat);

  const openDrawer = (tab) =>
    setDrawer((d) => (d.open && d.tab === tab ? { ...d, open: false } : { open: true, tab }));
  const closeDrawer = useCallback(() => setDrawer((d) => ({ ...d, open: false })), []);
  const selectTab = useCallback((tab) => setDrawer((d) => ({ ...d, tab })), []);

  // Keep <html lang> in sync so assistive tech uses the right language.
  useEffect(() => {
    document.documentElement.lang = locale || 'en';
  }, [locale]);

  // Restore the saved profile (name, avatar, sound, language) once.
  useEffect(() => {
    useGameStore.getState().hydrate();
  }, []);

  if (!connected) {
    return (
      <div className="app app--center">
        <p className="connecting">{t('app.connecting')}</p>
      </div>
    );
  }

  if (!tableId) {
    return (
      <div className="app app--center">
        <ErrorBar error={error} />
        <JoinScreen />
      </div>
    );
  }

  const handNumber = snapshot ? snapshot.handNumber : 0;
  const seated = snapshot ? snapshot.players.length : 0;

  return (
    <div className={`game${drawer.open ? ' game--drawer' : ''}`}>
      <a className="skip-link" href="#play">
        {t('a11y.skipToTable')}
      </a>

      <main className="stage" id="play" tabIndex={-1}>
        <div className="stage__floor" aria-hidden="true" />
        <header className="topbar">
          <div className="topbar__badge">
            <span className="topbar__title">{t('app.title')}</span>
            <span className="topbar__meta">{t('app.table', { id: tableId })}</span>
          </div>
          <div className="topbar__actions">
            <IconButton label={t('hud.sound')} onClick={() => setSfx({ muted: !sfx.muted })}>
              <SoundIcon muted={sfx.muted} />
            </IconButton>
            <IconButton label={t('hud.settings')} onClick={() => settingsRef.current?.showModal()}>
              <GearIcon />
            </IconButton>
            <IconButton label={t('hud.leave')} onClick={() => leave()}>
              <ExitIcon />
            </IconButton>
          </div>
        </header>
        <ErrorBar error={error} />
        <div className="stage__table">
          {snapshot ? <Table snapshot={snapshot} /> : <p className="connecting">{t('app.loadingTable')}</p>}
        </div>
      </main>

      <footer className="hudbar">
        <div className="hudbar__left">
          <IconButton label={t('hud.chat')} onClick={() => openDrawer('chat')} badge={unread}>
            <ChatIcon size={22} />
          </IconButton>
          <HandReadout snapshot={snapshot} playerId={playerId} locale={locale} />
        </div>
        <div className="hudbar__center">
          {snapshot && (spectator.active ? <SpectatorBar /> : <Controls snapshot={snapshot} />)}
        </div>
        <div className="hudbar__right">
          <div className="hudbar__box hudbar__info">
            <span>
              {handNumber > 0 ? t('hud.handNo', { n: handNumber }) : t('app.table', { id: tableId })}
            </span>
            {snapshot && <span>{t('app.blinds', { sb: snapshot.smallBlind, bb: snapshot.bigBlind })}</span>}
            <span>{t('hud.players', { n: seated })}</span>
          </div>
          <div className="hudbar__buttons">
            <IconButton label={t('hud.history')} onClick={() => openDrawer('history')}>
              <HistoryIcon />
            </IconButton>
            <IconButton label={t('hud.learn')} onClick={() => openDrawer('learn')}>
              <BookIcon />
            </IconButton>
          </div>
        </div>
      </footer>

      <SidePanel open={drawer.open} tab={drawer.tab} onTab={selectTab} onClose={closeDrawer} />
      <SettingsDialog dialogRef={settingsRef} />
    </div>
  );
}
