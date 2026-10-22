import { useEffect, useRef, useState } from 'react';
import { DIFFICULTIES } from '@saloon/shared';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';
import { actionOptions, sizingPresets } from '../actionOptions.js';
import { sfxService } from '../services/sfxService.js';

const fmt = (n) => Number(n).toLocaleString();

/** Your turn: Fold / Check-or-Call / Raise, plus bet sizing. */
function TurnPanel({ opts, onAct, clock }) {
  const [want, setWant] = useState(opts.raiseAction ? opts.minTotal : 0);
  const actRef = useRef(null);
  const allInTotal = opts.committed + opts.stack;
  const amount = Math.max(opts.minTotal, Math.min(opts.maxTotal, Number(want) || opts.minTotal));
  const raiseIsAllIn = opts.raiseAction && amount >= allInTotal;
  const presets = sizingPresets(opts);

  const raise = () => {
    if (raiseIsAllIn || !opts.raiseAction) onAct('allin');
    else onAct(opts.raiseAction, amount);
  };

  const raiseLabel =
    !opts.raiseAction || raiseIsAllIn
      ? t('controls.act.allin')
      : t(opts.raiseAction === 'bet' ? 'controls.act.bet' : 'controls.act.raise');
  const raiseAmount = !opts.raiseAction || raiseIsAllIn ? allInTotal : amount;
  // An all-in that cannot even cover the call is offered on the call button.
  const showRaise = opts.raiseAction || allInTotal > opts.committed + opts.toCall;
  const callOrCheck = () => onAct(opts.canCheck ? 'check' : 'call');

  // Keyboard: F fold, C check/call, R bet/raise, A all-in (ignored while typing).
  useEffect(() => {
    actRef.current = {
      fold: () => onAct('fold'),
      call: callOrCheck,
      raise: showRaise ? raise : null,
      allin: () => onAct('allin')
    };
  });
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !actRef.current) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const a = actRef.current;
      const key = e.key.toLowerCase();
      if (key === 'f') a.fold();
      else if (key === 'c') a.call();
      else if (key === 'r' && a.raise) a.raise();
      else if (key === 'a') a.allin();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A quiet tick each second once your clock is nearly out.
  useEffect(() => {
    if (!clock) return undefined;
    const id = setInterval(() => {
      const left = clock.remainingMs - (Date.now() - clock.at);
      if (left > 0 && left <= 5200) sfxService.play('tick');
    }, 1000);
    return () => clearInterval(id);
  }, [clock]);

  return (
    <div className="actions" role="group" aria-label={t('controls.yourTurn')}>
      <div className="actions__main">
        <button
          type="button"
          className="act act--fold"
          onClick={() => onAct('fold')}
          title={t('controls.key', { key: 'F' })}
        >
          {t('controls.act.fold')}
        </button>
        {opts.canCheck ? (
          <button
            type="button"
            className="act act--call"
            onClick={() => onAct('check')}
            title={t('controls.key', { key: 'C' })}
          >
            {t('controls.act.check')}
          </button>
        ) : (
          <button
            type="button"
            className="act act--call"
            onClick={() => onAct('call')}
            title={t('controls.key', { key: 'C' })}
          >
            {opts.callAmount < opts.toCall ? t('controls.act.allin') : t('controls.act.call')}
            <small>{fmt(opts.callAmount)}</small>
          </button>
        )}
        {showRaise && (
          <button
            type="button"
            className="act act--raise"
            onClick={raise}
            title={t('controls.key', { key: 'R' })}
          >
            {raiseLabel}
            <small>{fmt(raiseAmount)}</small>
          </button>
        )}
      </div>

      {opts.raiseAction && (
        <div className="actions__size">
          <div className="actions__presets" role="group" aria-label={t('controls.amount')}>
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`preset${amount === p.total ? ' preset--on' : ''}`}
                onClick={() => setWant(p.total)}
              >
                {t(`controls.size.${p.key}`)}
              </button>
            ))}
          </div>
          <input
            type="number"
            className="actions__amount"
            min={opts.minTotal}
            max={opts.maxTotal}
            value={want}
            onChange={(e) => setWant(e.target.value)}
            onBlur={() => setWant(amount)}
            aria-label={t('controls.amount')}
          />
          <input
            type="range"
            className="actions__slider"
            min={opts.minTotal}
            max={opts.maxTotal}
            step={1}
            value={amount}
            onChange={(e) => setWant(Number(e.target.value))}
            aria-label={t('controls.amount')}
          />
        </div>
      )}
    </div>
  );
}

const PRE_ACTIONS = ['checkfold', 'check', 'callany'];

/** Queue your next move while others act (it fires when your turn comes). */
function PreActions({ snapshot, me }) {
  const preAction = useGameStore((s) => s.preAction);
  const setPreAction = useGameStore((s) => s.setPreAction);
  if (!me || me.hasFolded || me.isAllIn || me.status !== 'in-hand') return null;
  const owes = Math.max(
    0,
    snapshot.currentBet - ((me.contributions && me.contributions[snapshot.street]) || 0)
  );
  const active = preAction && preAction.hand === snapshot.handNumber ? preAction.kind : null;
  return (
    <div className="preactions" role="group" aria-label={t('controls.pre.label')}>
      {PRE_ACTIONS.filter((k) => !(k === 'check' && owes > 0)).map((k) => (
        <label key={k} className={`preaction${active === k ? ' preaction--on' : ''}`}>
          <input
            type="checkbox"
            checked={active === k}
            onChange={(e) => setPreAction(e.target.checked ? k : null)}
          />
          <span>
            {k === 'callany' && owes > 0
              ? t('controls.pre.call', { n: fmt(Math.min(owes, me.chips)) })
              : t(`controls.pre.${k}`)}
          </span>
        </label>
      ))}
    </div>
  );
}

function WaitingPanel({ snapshot, me }) {
  const botActions = useGameStore((s) => s.botActions);
  const nextActor = snapshot.nextActorId ? snapshot.players.find((p) => p.id === snapshot.nextActorId) : null;
  const note = nextActor && nextActor.isBot ? botActions[nextActor.id] : null;
  let text = t('controls.waiting');
  if (nextActor) {
    text = nextActor.isBot
      ? t('controls.botThinking', { name: nextActor.name })
      : t('controls.waitingFor', { name: nextActor.name });
  }
  return (
    <div className="actions actions--waiting">
      <div className="actions__status" role="status" aria-live="polite">
        <span className="actions__dot" aria-hidden="true" />
        <span className="actions__waiting">{text}</span>
        {note && (
          <span className="actions__note" title={note.reason}>
            {t('controls.lastMove', { action: t(`action.${note.action}`) })}
          </span>
        )}
      </div>
      <PreActions snapshot={snapshot} me={me} />
    </div>
  );
}

function IdlePanel({ snapshot }) {
  const playerId = useGameStore((s) => s.playerId);
  const rebuy = useGameStore((s) => s.rebuy);
  const startHand = useGameStore((s) => s.startHand);
  const addBot = useGameStore((s) => s.addBot);
  const [cpuDifficulty, setCpuDifficulty] = useState('normal');
  const [adding, setAdding] = useState(false);
  const seatsFull = snapshot.players.length >= 10;
  const funded = snapshot.players.filter((p) => p.chips > 0).length;
  const me = snapshot.players.find((p) => p.id === playerId);
  const busted = me && me.chips === 0;

  const onAddCpu = async () => {
    setAdding(true);
    await addBot(cpuDifficulty);
    setAdding(false);
  };

  return (
    <div className="actions actions--idle">
      <div className="actions__main">
        {busted ? (
          <button type="button" className="act act--raise" onClick={() => rebuy()}>
            {t('controls.rebuy', { n: fmt(snapshot.startingStack) })}
          </button>
        ) : (
          <button
            type="button"
            className="act act--call"
            onClick={() => startHand()}
            disabled={funded < 2 && snapshot.players.length > 0}
          >
            {t('controls.startHand')}
          </button>
        )}
      </div>
      <div className="actions__cpu" title={t('controls.addCpuHint')}>
        <label htmlFor="cpu-difficulty">{t('controls.addCpu')}</label>
        <select
          id="cpu-difficulty"
          value={cpuDifficulty}
          disabled={seatsFull || adding}
          onChange={(e) => setCpuDifficulty(e.target.value)}
        >
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {t(`difficulty.${d}`)}
            </option>
          ))}
        </select>
        <button type="button" className="preset" onClick={onAddCpu} disabled={seatsFull || adding}>
          {adding ? t('controls.addingCpu') : `+ ${t('controls.cpu')}`}
        </button>
      </div>
      {!busted && funded < 2 && snapshot.players.length > 0 && (
        <p className="actions__hint">{t('controls.needPlayers')}</p>
      )}
      {seatsFull && <p className="actions__hint">{t('controls.tableFull')}</p>}
    </div>
  );
}

/** Fire a queued pre-action as soon as it becomes your turn. */
function usePreActionFire(snapshot, opts, onAct) {
  const preAction = useGameStore((s) => s.preAction);
  const setPreAction = useGameStore((s) => s.setPreAction);
  const handNumber = snapshot.handNumber;
  useEffect(() => {
    if (!opts || !preAction) return;
    setPreAction(null);
    if (preAction.hand !== handNumber) return;
    const kind = preAction.kind;
    if (kind === 'checkfold') onAct(opts.canCheck ? 'check' : 'fold');
    else if (kind === 'callany') onAct(opts.canCheck ? 'check' : 'call');
    // "Check" only stands if nobody has bet since you ticked it.
    else if (kind === 'check' && opts.canCheck) onAct('check');
  }, [opts, preAction, handNumber, setPreAction, onAct]);
}

export default function Controls({ snapshot }) {
  const playerId = useGameStore((s) => s.playerId);
  const playerAction = useGameStore((s) => s.playerAction);
  const snapshotAt = useGameStore((s) => s.snapshotAt);
  const me = snapshot.players.find((p) => p.id === playerId);
  const opts = snapshot.inHand ? actionOptions(snapshot, playerId) : null;
  usePreActionFire(snapshot, opts, playerAction);

  const sittingOut = me && me.chips === 0 && me.status !== 'in-hand';
  // Out of chips: offer the buy-back even while the others play on.
  if (!snapshot.inHand || sittingOut) return <IdlePanel snapshot={snapshot} />;
  if (!opts) return <WaitingPanel snapshot={snapshot} me={me} />;
  const clock =
    snapshot.turn && snapshot.turn.playerId === playerId
      ? { remainingMs: snapshot.turn.remainingMs, at: snapshotAt }
      : null;
  return (
    <TurnPanel
      key={`${snapshot.handNumber}-${snapshot.street}-${snapshot.currentBet}`}
      opts={opts}
      onAct={playerAction}
      clock={clock}
    />
  );
}
