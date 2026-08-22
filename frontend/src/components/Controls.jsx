import { useMemo, useState } from 'react';
import { minRaise, maxBet } from '@saloon/shared/bettingRules';
import { DIFFICULTIES } from '@saloon/shared';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';

export default function Controls({ snapshot }) {
  const playerId = useGameStore((s) => s.playerId);
  const botActions = useGameStore((s) => s.botActions);
  const playerAction = useGameStore((s) => s.playerAction);
  const startHand = useGameStore((s) => s.startHand);
  const addBot = useGameStore((s) => s.addBot);
  const [customAmount, setCustomAmount] = useState('');
  const [cpuDifficulty, setCpuDifficulty] = useState('normal');
  const [adding, setAdding] = useState(false);

  const me = snapshot.players.find((p) => p.id === playerId);
  const myTurn = snapshot.inHand && snapshot.nextActorId === playerId && me && !me.hasFolded && !me.isAllIn;

  // While waiting, show who is acting and (for bots) their last reasoning line.
  const nextActor = snapshot.inHand && snapshot.nextActorId
    ? snapshot.players.find((p) => p.id === snapshot.nextActorId)
    : null;
  const nextBotNote = nextActor && nextActor.isBot ? botActions[nextActor.id] : null;

  const committed = me ? (me.contributions[snapshot.street] || 0) : 0;
  const toCall = Math.max(0, snapshot.currentBet - committed);
  const chips = me ? me.chips : 0;

  const isNoLimit = snapshot.gameType !== 'limit' && snapshot.gameType !== 'pot-limit';
  const limit = maxBet(snapshot.gameType, snapshot.pot, snapshot.street, snapshot.bigBlind, snapshot.currentBet);
  const maxTarget = limit === null ? chips : Math.min(limit, chips);
  const minTarget = toCall > 0 ? minRaise(snapshot.currentBet, snapshot.bigBlind, snapshot.lastRaiseIncrement) : snapshot.bigBlind;

  const clamp = (n) => Math.max(0, Math.min(n, chips));
  const callAmount = clamp(toCall);
  const minRaiseAmount = clamp(Math.max(minTarget, snapshot.bigBlind));
  const maxRaiseAmount = clamp(Math.max(maxTarget, minRaiseAmount));
  const minBetAmount = clamp(snapshot.bigBlind);

  const presets = useMemo(() => {
    if (!myTurn) return [];
    if (toCall === 0) {
      return [
        { label: t('controls.check'), action: 'check', amount: 0 },
        { label: t('controls.bet', { n: minBetAmount }), action: 'bet', amount: minBetAmount },
        { label: t('controls.max', { n: maxTarget }), action: 'bet', amount: maxTarget },
        { label: t('controls.allin'), action: 'allin', amount: 0 }
      ];
    }
    return [
      { label: t('controls.call', { n: callAmount }), action: 'call', amount: 0 },
      { label: t('controls.minRaise', { n: minRaiseAmount }), action: 'raise', amount: minRaiseAmount },
      { label: t('controls.max', { n: maxRaiseAmount }), action: 'raise', amount: maxRaiseAmount },
      { label: t('controls.allin'), action: 'allin', amount: 0 }
    ];
  }, [myTurn, toCall, minBetAmount, maxTarget, callAmount, minRaiseAmount, maxRaiseAmount]);

  if (snapshot.inHand) {
    if (!myTurn) {
      return (
        <div className="controls controls--idle" role="status" aria-live="polite">
          {nextActor && nextActor.isBot ? (
            <>
              <span className="controls__waiting">
                {t('controls.botThinking', { name: nextActor.name })}
              </span>
              {nextBotNote && (
                <span className="controls__botreason" title={nextBotNote.reason}>
                  {t('controls.lastMove', { action: nextBotNote.action })}
                  {typeof nextBotNote.confidence === 'number' && (
                    <> {t('controls.confidence', { n: Math.round(nextBotNote.confidence * 100) })}</>
                  )}
                </span>
              )}
            </>
          ) : (
            <span className="controls__waiting">{t('controls.waiting')}</span>
          )}
        </div>
      );
    }
    return (
      <div className="controls">
        <div className="controls__row">
          {presets.map((p) => (
            <button
              key={p.label}
              className="btn btn--action"
              disabled={p.action === 'raise' && p.amount > chips}
              onClick={() => playerAction(p.action, p.amount)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {isNoLimit && (
          <div className="controls__row controls__custom">
            <input
              className="amount"
              type="number"
              min={0}
              max={chips}
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder={t('controls.customPlaceholder')}
            />
            <button
              className="btn"
              disabled={!customAmount}
              onClick={() => {
                const amt = Number(customAmount);
                playerAction(toCall > 0 ? 'raise' : 'bet', amt);
                setCustomAmount('');
              }}
            >
              {t('controls.place')}
            </button>
          </div>
        )}
        <button className="btn btn--fold" onClick={() => playerAction('fold')}>
          {t('controls.fold')}
        </button>
      </div>
    );
  }

  const seatCount = snapshot.players.length;
  const seatsFull = seatCount >= 10;

  const onAddCpu = async () => {
    setAdding(true);
    await addBot(cpuDifficulty); // keep the chosen difficulty so several bots can be added in a row
    setAdding(false);
  };

  return (
    <div className="controls controls--idle">
      <div className="controls__row controls__idle-row">
        <button className="btn btn--primary" onClick={() => startHand()}>
          {t('controls.startHand')}
        </button>
        <span className="controls__idle-sep" aria-hidden="true" />
        <label className="controls__cpu" title={t('controls.addCpuHint')}>
          <span className="controls__cpu-label">{t('controls.addCpu')}</span>
          <select
            className="controls__cpu-select"
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
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onAddCpu}
            disabled={seatsFull || adding}
          >
            {adding ? t('controls.addingCpu') : `+ ${t('controls.cpu')}`}
          </button>
        </label>
      </div>
      {seatsFull && <p className="controls__hint">{t('controls.tableFull')}</p>}
    </div>
  );
}
