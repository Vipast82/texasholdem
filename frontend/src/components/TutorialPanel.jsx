import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store.js';
import { t, setLocale } from '../i18n.js';
import { TutorialEngine } from '../engine/tutorialEngine.js';
import { narrationService } from '../engine/narrationService.js';
import { strategyHint } from '@saloon/shared/tutorialHint';
import { loadTutorialContent } from '../tutorial/content.js';
import tutorialSeed from '../tutorial/tutorialSeed.json';

/**
 * TutorialPanel - settings + live event log + pause control + seeded run.
 * Owns the TutorialEngine (one per mount), pipes the server's `gameEvent`
 * stream into it, and renders the localized history. The engine is pure;
 * this component is the I/O/UI boundary (socket, narration, i18n).
 */
export default function TutorialPanel() {
  const tutorial = useGameStore((s) => s.tutorial);
  const tableId = useGameStore((s) => s.tableId);
  const engineRef = useRef(null);
  const [history, setHistory] = useState([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);

  if (!engineRef.current) {
    engineRef.current = new TutorialEngine({
      content: loadTutorialContent(),
      mode: tutorial.mode,
      verbosity: tutorial.verbosity,
      hintsEnabled: tutorial.hintsEnabled,
      hintProvider: strategyHint,
      narration: narrationService,
      resolveText: (key, vars) => t(key, vars)
    });
  }
  const engine = engineRef.current;

  useEffect(() => {
    engine.setMode(tutorial.mode);
    engine.setVerbosity(tutorial.verbosity);
    engine.setHintsEnabled(tutorial.hintsEnabled);
    if (tutorial.mode !== 'guided') setPaused(false);
  }, [engine, tutorial.mode, tutorial.verbosity, tutorial.hintsEnabled]);

  useEffect(() => {
    if (tutorial.locale) setLocale(tutorial.locale);
  }, [tutorial.locale]);

  useEffect(() => {
    const store = useGameStore.getState();
    store.setTutorialEventCb((event, payload) => {
      const item = engine.handleEvent(event, payload, hintContext(event, payload));
      if (item) {
        setHistory((h) => [item, ...h].slice(0, 50));
        setPaused(!!item.paused);
      } else {
        // An event that produced no tutorial item clears any active pause.
        setPaused(false);
      }
    });
    return () => store.setTutorialEventCb(null);
  }, [engine]);

  const runSeeded = async () => {
    if (running) return;
    setRunning(true);
    try {
      const res = await useGameStore.getState().startHand(tutorialSeed.seed);
      if (res && !res.ok) useGameStore.getState().setError(res.error);
    } finally {
      setRunning(false);
    }
  };

  const isPaused = paused;
  const modes = ['off', 'passive', 'guided'];
  const verbosities = ['concise', 'normal', 'detailed'];
  const locales = ['en', 'es'];

  return (
    <section className="tutorial" aria-label={t('tutorial.panel')}>
      <div className="tutorial__head">
        <h2>{t('tutorial.panel')}</h2>
        <button
          className="btn btn--primary"
          type="button"
          onClick={runSeeded}
          disabled={running || !tableId}
        >
          {running ? t('settings.runningTutorial') : t('settings.runTutorial')}
        </button>
      </div>

      <div className="tutorial__settings">
        <Field
          id="tut-mode"
          label={t('settings.mode')}
          value={tutorial.mode}
          options={modes.map((m) => ({ v: m, l: t(`settings.mode.${m}`) }))}
          onChange={(v) => useGameStore.getState().setTutorial({ mode: v })}
        />
        <Field
          id="tut-verbosity"
          label={t('settings.verbosity')}
          value={tutorial.verbosity}
          options={verbosities.map((v) => ({ v, l: t(`settings.verbosity.${v}`) }))}
          onChange={(v) => useGameStore.getState().setTutorial({ verbosity: v })}
        />
        <Field
          id="tut-hints"
          label={t('settings.hints')}
          value={tutorial.hintsEnabled ? 'on' : 'off'}
          options={[
            { v: 'on', l: t('settings.hints.on') },
            { v: 'off', l: t('settings.hints.off') }
          ]}
          onChange={(v) => useGameStore.getState().setTutorial({ hintsEnabled: v === 'on' })}
        />
        <Field
          id="tut-locale"
          label={t('settings.language')}
          value={tutorial.locale}
          options={locales.map((l) => ({ v: l, l: l.toUpperCase() }))}
          onChange={(v) => useGameStore.getState().setLocale(v)}
        />
      </div>

      <ul className="tutorial__log" role="log" aria-live="polite">
        {history.length === 0 && <li className="tutorial__empty">{t('tutorial.empty')}</li>}
        {history.map((item, i) => (
          <li key={i} className={`tutorial__item ${i === 0 ? 'tutorial__item--current' : ''}`}>
            <span className="tutorial__title">{item.title}</span>
            {item.message && <div>{item.message}</div>}
            {renderHint(item)}
          </li>
        ))}
      </ul>

      {isPaused && (
        <div className="tutorial__paused">
          <span>{t('tutorial.panel')}</span>
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => {
              engine.continue();
              setPaused(false);
            }}
          >
            {t('tutorial.continue')}
          </button>
        </div>
      )}
    </section>
  );
}

/** Reusable localized <select> field (mode / verbosity / hints / language). */
function Field({ id, label, value, options, onChange }) {
  return (
    <div className="tutorial__field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Localized strategy-hint line (action + reason + confidence), or null. */
function renderHint(item) {
  const hint = item.strategyHint;
  if (!hint || !hint.enabled) return null;
  const actionLabel = hint.action ? t(`tut.hint.action.${hint.action}`, {}, hint.action) : '';
  return (
    <div className="tutorial__hint">
      <strong>{t('tutorial.hint')}:</strong> {actionLabel}
      {hint.reason ? <em> — {hint.reason}</em> : null}
      {hint.confidence != null ? (
        <>
          {' '}
          ({t('tutorial.confidence', { n: Math.round(hint.confidence * 100) })})
        </>
      ) : null}
    </div>
  );
}

/** Hint context from the last broadcast snapshot (UI supplies the live state). */
function hintContext(event, payload) {
  const snapshot = useGameStore.getState().snapshot;
  if (!snapshot || !snapshot.players || !snapshot.players.length) return null;
  const actor =
    (payload && payload.playerId) ||
    (snapshot.players.find((p) => p.toAct && !p.hasFolded) || snapshot.players[0]).id;
  return { game: snapshot, actorId: actor, seed: `hint:${event}:${Date.now()}` };
}
