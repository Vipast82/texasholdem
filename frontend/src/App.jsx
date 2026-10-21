import { useEffect, useRef } from 'react';
import { useGameStore } from './store.js';
import JoinScreen from './components/JoinScreen.jsx';
import Table from './components/Table.jsx';
import Controls from './components/Controls.jsx';
import SidePanel from './components/SidePanel.jsx';
import SpectatorBar from './components/SpectatorBar.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
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

export default function App() {
  const connected = useGameStore((s) => s.connected);
  const tableId = useGameStore((s) => s.tableId);
  const snapshot = useGameStore((s) => s.snapshot);
  const error = useGameStore((s) => s.error);
  const spectator = useGameStore((s) => s.spectator);
  const locale = useGameStore((s) => s.tutorial.locale);
  const leave = useGameStore((s) => s.leave);
  const settingsRef = useRef(null);

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

  return (
    <div className="app app--table">
      <a className="skip-link" href="#play">
        {t('a11y.skipToTable')}
      </a>
      <header className="topbar">
        <h1 className="topbar__title">{t('app.title')}</h1>
        <span className="topbar__meta">
          {t('app.table', { id: tableId })}
          {handNumber > 0 && <span className="topbar__hand">{t('app.hand', { n: handNumber })}</span>}
          {snapshot && (
            <span className="topbar__hand">
              {t('app.blinds', { sb: snapshot.smallBlind, bb: snapshot.bigBlind })}
            </span>
          )}
        </span>
        <div className="topbar__actions">
          <button type="button" className="btn btn--ghost" onClick={() => settingsRef.current?.showModal()}>
            {t('settings.title')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => leave()}>
            {t('app.leave')}
          </button>
        </div>
      </header>

      <main className="play" id="play" tabIndex={-1}>
        <div className="play__table">
          {snapshot ? <Table snapshot={snapshot} /> : <p className="connecting">{t('app.loadingTable')}</p>}
        </div>
        <div className="play__bar">
          <ErrorBar error={error} />
          {snapshot && (spectator.active ? <SpectatorBar /> : <Controls snapshot={snapshot} />)}
        </div>
      </main>

      <SidePanel />
      <SettingsDialog dialogRef={settingsRef} />
    </div>
  );
}
