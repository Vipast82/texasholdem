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

/** Short-lived table announcements (joins, blinds going up, eliminations…). */
function Toasts() {
  const toasts = useGameStore((s) => s.toasts);
  const dismiss = useGameStore((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((n) => (
        <button key={n.id} type="button" className="toast" onClick={() => dismiss(n.id)}>
          {t(n.key, n.vars)}
        </button>
      ))}
    </div>
  );
}

/** Final standings when a tournament ends, with a rematch. */
function TournamentOver({ snapshot, playerId }) {
  const restart = useGameStore((s) => s.restartTournament);
  const leave = useGameStore((s) => s.leave);
  const tour = snapshot && snapshot.tournament;
  if (!tour || !tour.finished || !tour.standings) return null;
  const mine = tour.standings.find((r) => r.id === playerId);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="overlay__card">
        <h2 id="tour-title" className="overlay__title">
          {mine && mine.place === 1 ? t('tour.youWon') : t('tour.over')}
        </h2>
        {mine && mine.place > 1 && <p className="overlay__sub">{t('tour.youPlaced', { n: mine.place })}</p>}
        <ol className="standings">
          {tour.standings.map((r) => (
            <li key={r.id} className={`standings__row${r.id === playerId ? ' standings__row--me' : ''}`}>
              <span className="standings__place">{r.place}</span>
              <span className="standings__name">{r.name}</span>
              {r.place === 1 && <span className="standings__badge">{t('tour.champion')}</span>}
            </li>
          ))}
        </ol>
        <div className="overlay__actions">
          <button type="button" className="btn btn--ghost" onClick={() => leave()}>
            {t('app.leave')}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => restart()}>
            {t('tour.again')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Table info in the HUD: hand number, blinds, players — plus the tournament clock. */
function TableInfo({ snapshot, tableId }) {
  const handNumber = snapshot ? snapshot.handNumber : 0;
  const tour = snapshot && snapshot.tournament;
  return (
    <div className="hudbar__box hudbar__info">
      <span>{handNumber > 0 ? t('hud.handNo', { n: handNumber }) : t('app.table', { id: tableId })}</span>
      {snapshot && (
        <span>
          {tour ? t('hud.level', { n: tour.level }) + ' · ' : ''}
          {t('app.blinds', { sb: snapshot.smallBlind, bb: snapshot.bigBlind })}
        </span>
      )}
      {tour && !tour.finished ? (
        <span>
          {t('hud.nextLevel', { sb: tour.nextBlinds[0], bb: tour.nextBlinds[1], n: tour.handsLeftInLevel })}
        </span>
      ) : (
        <span>{t('hud.players', { n: snapshot ? snapshot.players.length : 0 })}</span>
      )}
    </div>
  );
}

/** Sit out the next hands (or come back). */
function SitOutToggle({ snapshot, playerId }) {
  const sitOut = useGameStore((s) => s.sitOut);
  const me = snapshot && snapshot.players.find((p) => p.id === playerId);
  if (!me) return null;
  return (
    <button
      type="button"
      className={`sitout${me.sittingOut ? ' sitout--on' : ''}`}
      aria-pressed={!!me.sittingOut}
      onClick={() => sitOut(!me.sittingOut)}
    >
      {me.sittingOut ? t('hud.imBack') : t('hud.sitOut')}
    </button>
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
  const fourColor = useGameStore((s) => s.profile.settings.fourColor);
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

  return (
    <div className={`game${drawer.open ? ' game--drawer' : ''}${fourColor ? ' game--fourcolor' : ''}`}>
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
        <Toasts />
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
          <TableInfo snapshot={snapshot} tableId={tableId} />
          <div className="hudbar__buttons">
            {!spectator.active && <SitOutToggle snapshot={snapshot} playerId={playerId} />}
            <IconButton label={t('hud.history')} onClick={() => openDrawer('history')}>
              <HistoryIcon />
            </IconButton>
            <IconButton label={t('hud.learn')} onClick={() => openDrawer('learn')}>
              <BookIcon />
            </IconButton>
          </div>
        </div>
      </footer>

      <TournamentOver snapshot={snapshot} playerId={playerId} />
      <SidePanel open={drawer.open} tab={drawer.tab} onTab={selectTab} onClose={closeDrawer} />
      <SettingsDialog dialogRef={settingsRef} />
    </div>
  );
}
