import { useState } from 'react';
import { DIFFICULTIES } from '@saloon/shared';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';
import { actionOptions, sizingPresets } from '../actionOptions.js';

/** Raise-size picker: quick pot fractions, a slider, and an exact number box. */
function RaiseControls({ opts, onRaise }) {
  const [total, setTotal] = useState(opts.minTotal);
  const clamped = Math.max(opts.minTotal, Math.min(opts.maxTotal, Number(total) || opts.minTotal));
  const label = opts.raiseAction === 'bet' ? 'controls.betTo' : 'controls.raiseTo';
  const presets = sizingPresets(opts);

  return (
    <div className="raise">
      <div className="raise__presets">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`chipbtn${clamped === p.total ? ' chipbtn--on' : ''}`}
            onClick={() => setTotal(p.total)}
          >
            {t(`controls.size.${p.key}`)}
          </button>
        ))}
      </div>
      <div className="raise__pick">
        <input
          type="range"
          className="raise__slider"
          min={opts.minTotal}
          max={opts.maxTotal}
          step={1}
          value={clamped}
          onChange={(e) => setTotal(Number(e.target.value))}
          aria-label={t('controls.amount')}
        />
        <input
          type="number"
          className="raise__amount"
          min={opts.minTotal}
          max={opts.maxTotal}
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          onBlur={() => setTotal(clamped)}
          aria-label={t('controls.amount')}
        />
      </div>
      <button type="button" className="btn btn--raise" onClick={() => onRaise(opts.raiseAction, clamped)}>
        {t(label, { n: clamped.toLocaleString() })}
      </button>
    </div>
  );
}

function WaitingBar({ snapshot }) {
  const botActions = useGameStore((s) => s.botActions);
  const nextActor = snapshot.nextActorId ? snapshot.players.find((p) => p.id === snapshot.nextActorId) : null;
  const note = nextActor && nextActor.isBot ? botActions[nextActor.id] : null;
  return (
    <div className="controls controls--waiting" role="status" aria-live="polite">
      <span className="controls__dot" aria-hidden="true" />
      {nextActor ? (
        <span className="controls__waiting">
          {nextActor.isBot
            ? t('controls.botThinking', { name: nextActor.name })
            : t('controls.waitingFor', { name: nextActor.name })}
        </span>
      ) : (
        <span className="controls__waiting">{t('controls.waiting')}</span>
      )}
      {note && (
        <span className="controls__botreason" title={note.reason}>
          {t('controls.lastMove', { action: note.action })}
        </span>
      )}
    </div>
  );
}

function IdleBar({ snapshot }) {
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
    <div className="controls controls--idle">
      {busted ? (
        <button type="button" className="btn btn--primary btn--lg" onClick={() => rebuy()}>
          {t('controls.rebuy', { n: snapshot.startingStack.toLocaleString() })}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--primary btn--lg"
          onClick={() => startHand()}
          disabled={funded < 2 && snapshot.players.length > 0}
        >
          {t('controls.startHand')}
        </button>
      )}
      <div className="controls__cpu" title={t('controls.addCpuHint')}>
        <label htmlFor="cpu-difficulty" className="controls__cpu-label">
          {t('controls.addCpu')}
        </label>
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
        <button type="button" className="btn btn--ghost" onClick={onAddCpu} disabled={seatsFull || adding}>
          {adding ? t('controls.addingCpu') : `+ ${t('controls.cpu')}`}
        </button>
      </div>
      {!busted && funded < 2 && snapshot.players.length > 0 && (
        <p className="controls__hint">{t('controls.needPlayers')}</p>
      )}
      {seatsFull && <p className="controls__hint">{t('controls.tableFull')}</p>}
    </div>
  );
}

export default function Controls({ snapshot }) {
  const playerId = useGameStore((s) => s.playerId);
  const playerAction = useGameStore((s) => s.playerAction);

  if (!snapshot.inHand) return <IdleBar snapshot={snapshot} />;

  const opts = actionOptions(snapshot, playerId);
  if (!opts) return <WaitingBar snapshot={snapshot} />;

  const allInTotal = opts.committed + opts.stack;
  return (
    <div className="controls controls--turn" role="group" aria-label={t('controls.yourTurn')}>
      <div className="controls__info">
        <span className="controls__turn">{t('controls.yourTurn')}</span>
        {opts.toCall > 0 && <span>{t('controls.toCall', { n: opts.toCall.toLocaleString() })}</span>}
      </div>
      <div className="controls__actions">
        <button type="button" className="btn btn--fold" onClick={() => playerAction('fold')}>
          {t('controls.fold')}
        </button>
        {opts.canCheck ? (
          <button type="button" className="btn btn--call" onClick={() => playerAction('check')}>
            {t('controls.check')}
          </button>
        ) : (
          <button type="button" className="btn btn--call" onClick={() => playerAction('call')}>
            {opts.callAmount < opts.toCall
              ? t('controls.callAllin', { n: opts.callAmount.toLocaleString() })
              : t('controls.call', { n: opts.callAmount.toLocaleString() })}
          </button>
        )}
        {opts.raiseAction && (
          <RaiseControls
            key={`${snapshot.handNumber}-${snapshot.street}-${opts.minTotal}`}
            opts={opts}
            onRaise={playerAction}
          />
        )}
        {allInTotal > snapshot.currentBet && (
          <button type="button" className="btn btn--allin" onClick={() => playerAction('allin')}>
            {t('controls.allinN', { n: allInTotal.toLocaleString() })}
          </button>
        )}
      </div>
    </div>
  );
}
