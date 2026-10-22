import { useState } from 'react';
import { DIFFICULTIES } from '@saloon/shared';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';
import { actionOptions, sizingPresets } from '../actionOptions.js';

const fmt = (n) => Number(n).toLocaleString();

/** Your turn: Fold / Check-or-Call / Raise, plus bet sizing. */
function TurnPanel({ opts, onAct }) {
  const [want, setWant] = useState(opts.raiseAction ? opts.minTotal : 0);
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

  return (
    <div className="actions" role="group" aria-label={t('controls.yourTurn')}>
      <div className="actions__main">
        <button type="button" className="act act--fold" onClick={() => onAct('fold')}>
          {t('controls.act.fold')}
        </button>
        {opts.canCheck ? (
          <button type="button" className="act act--call" onClick={() => onAct('check')}>
            {t('controls.act.check')}
          </button>
        ) : (
          <button type="button" className="act act--call" onClick={() => onAct('call')}>
            {opts.callAmount < opts.toCall ? t('controls.act.allin') : t('controls.act.call')}
            <small>{fmt(opts.callAmount)}</small>
          </button>
        )}
        {showRaise && (
          <button type="button" className="act act--raise" onClick={raise}>
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

function WaitingPanel({ snapshot }) {
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
    <div className="actions actions--waiting" role="status" aria-live="polite">
      <span className="actions__dot" aria-hidden="true" />
      <span className="actions__waiting">{text}</span>
      {note && (
        <span className="actions__note" title={note.reason}>
          {t('controls.lastMove', { action: note.action })}
        </span>
      )}
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

export default function Controls({ snapshot }) {
  const playerId = useGameStore((s) => s.playerId);
  const playerAction = useGameStore((s) => s.playerAction);

  const me = snapshot.players.find((p) => p.id === playerId);
  const sittingOut = me && me.chips === 0 && me.status !== 'in-hand';
  // Out of chips: offer the buy-back even while the others play on.
  if (!snapshot.inHand || sittingOut) return <IdlePanel snapshot={snapshot} />;
  const opts = actionOptions(snapshot, playerId);
  if (!opts) return <WaitingPanel snapshot={snapshot} />;
  return (
    <TurnPanel
      key={`${snapshot.handNumber}-${snapshot.street}-${snapshot.currentBet}`}
      opts={opts}
      onAct={playerAction}
    />
  );
}
