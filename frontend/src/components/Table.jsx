import { useEffect, useRef, useState } from 'react';
import { categoryName } from '@saloon/shared';
import { parseDisplayCard } from '../cardUtils.js';
import { useGameStore } from '../store.js';
import { t, getLocale } from '../i18n.js';
import HudOdds from './HudOdds.jsx';
import DealerButton from './DealerButton.jsx';
import StickFigure from './StickFigure.jsx';
import BetChips from './BetChips.jsx';

const DENOMS = [1, 5, 25, 100, 500];

/**
 * Turn `on` for `durationMs` whenever `dep` changes (never on first mount, so
 * joining a table mid-hand does not fake a shuffle). Drives one-shot CSS
 * animations like the table wiggle on a new hand.
 */
function useTransientFlag(dep, durationMs = 800) {
  const [on, setOn] = useState(false);
  const firstRef = useRef(true);
  const prevRef = useRef(dep);
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      prevRef.current = dep;
      return undefined;
    }
    if (dep === prevRef.current) return undefined;
    prevRef.current = dep;
    const start = setTimeout(() => setOn(true), 0);
    const stop = setTimeout(() => setOn(false), durationMs);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, [dep, durationMs]);
  return on;
}

/**
 * All-in runouts deal the rest of the board in one server update. We reveal
 * those cards on a slow beat (turn, then river) instead of all at once. Delays
 * are in seconds, indexed by board position.
 */
const SLOW_REVEAL_DELAYS = [0, 0, 0, 1.3, 2.4];

function revealDelay(index, from) {
  const offset = from >= 3 ? SLOW_REVEAL_DELAYS[from] - 0.4 : 0;
  return Math.max(0, SLOW_REVEAL_DELAYS[index] - offset);
}

function runoutSettleMs(from) {
  return Math.round((revealDelay(4, from) + 0.9) * 1000);
}

export function Card({ card, size = 'md', className = '', style }) {
  const { rank, suit, isRed } = parseDisplayCard(card);
  return (
    <div className={`card card--${size} ${isRed ? 'card--red' : 'card--black'} ${className}`} style={style}>
      <span className="card__rank">{rank}</span>
      <span className="card__suit">{suit}</span>
    </div>
  );
}

function CardBack({ size = 'sm', className = '' }) {
  return <div className={`card card--${size} card--back ${className}`} aria-hidden="true" />;
}

/**
 * Seat positions (in % of the table box) for every player, in seat order,
 * going clockwise around the rail. You always sit at the bottom centre; a
 * spectator sees the lowest seat there instead.
 */
export function layoutSeats(players, playerId) {
  const RX = 47;
  const RY = 46;
  const n = players.length;
  const meIndex = Math.max(
    0,
    players.findIndex((p) => p.id === playerId)
  );
  return players.map((_, i) => {
    const step = (i - meIndex + n) % n;
    const angle = (2 * Math.PI * step) / n;
    const x = 50 - RX * Math.sin(angle);
    const y = 50 + RY * Math.cos(angle);
    return { x, y };
  });
}

function statusText(player, snapshot, botAction) {
  if (player.chips === 0 && !player.isAllIn && player.status !== 'in-hand') return t('seat.busted');
  if (player.hasFolded && snapshot.inHand) return t('seat.folded');
  if (player.isAllIn && snapshot.inHand) return t('seat.allin');
  if (player.isBot && botAction && snapshot.inHand) return t(`action.${botAction.action}`);
  return null;
}

function Seat({ player, snapshot, pos, isYou, isDealer, isActing, isWinner, botAction, emote, onRemoveBot }) {
  const inHand = player.status === 'in-hand';
  const folded = player.hasFolded && snapshot.inHand;
  const pose = isWinner
    ? 'winning'
    : player.isAllIn && snapshot.inHand
      ? 'allin'
      : folded
        ? 'folded'
        : isActing
          ? 'acting'
          : 'idle';
  const status = statusText(player, snapshot, botAction);
  const showCards = Array.isArray(player.holeCards) && player.holeCards.length === 2;
  // Keep the last hand's cards on screen until the next deal.
  const dealtIn = inHand || (!snapshot.inHand && snapshot.street === 'ended' && showCards);

  return (
    <div
      className={[
        'seat',
        isYou && 'seat--you',
        isActing && 'seat--acting',
        folded && 'seat--folded',
        isWinner && 'seat--winner'
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
    >
      <div className="seat__figure">
        <StickFigure player={player} pose={pose} emote={emote} isMe={isYou} />
        {isDealer && <DealerButton active seat={player.name} />}
      </div>

      <div className="seat__plate">
        <span className="seat__name">
          <span className="seat__nametext">{player.name}</span>
          {player.isBot && (
            <span
              className="seat__bot"
              title={t('seat.botTitle', { difficulty: (player.bot && player.bot.difficulty) || 'normal' })}
            >
              {t('seat.cpu')}
            </span>
          )}
        </span>
        <span className="seat__stack">{player.chips.toLocaleString()}</span>
        {status && <span className="seat__status">{status}</span>}
        {onRemoveBot && (
          <button
            type="button"
            className="seat__remove"
            aria-label={t('seat.removeBot', { name: player.name })}
            title={t('seat.removeBot', { name: player.name })}
            onClick={() => onRemoveBot(player.id)}
          >
            ×
          </button>
        )}
      </div>

      {dealtIn && (
        <div className={`seat__cards${isYou ? ' seat__cards--mine' : ''}`}>
          {showCards
            ? player.holeCards.map((c, i) => (
                <Card
                  key={c}
                  card={c}
                  size={isYou ? 'md' : 'sm'}
                  className="card--deal"
                  style={{ animationDelay: `${i * 0.12}s` }}
                />
              ))
            : [0, 1].map((i) => <CardBack key={i} className="card--deal" />)}
        </div>
      )}
      <HudOdds snapshot={snapshot} playerId={player.id} />
    </div>
  );
}

/** "Nina wins 3,000 with three of a kind" — the result of the hand just played. */
function resultText(snapshot) {
  const payouts = snapshot.payouts || {};
  const winners = Object.keys(payouts).filter((id) => payouts[id] > 0);
  if (!winners.length) return null;
  const nameOf = (id) => (snapshot.players.find((p) => p.id === id) || {}).name || '?';
  const total = winners.reduce((s, id) => s + payouts[id], 0);
  const names = winners.map(nameOf).join(' & ');
  const ranked = snapshot.lastShowdown && snapshot.lastShowdown.ranked;
  if (ranked && ranked.category != null) {
    return t(winners.length > 1 ? 'table.splitWith' : 'table.winsWith', {
      name: names,
      n: total.toLocaleString(),
      hand: categoryName(ranked.category, getLocale()).toLowerCase()
    });
  }
  return t('table.wins', { name: names, n: total.toLocaleString() });
}

export default function Table({ snapshot }) {
  const playerId = useGameStore((s) => s.playerId);
  const botActions = useGameStore((s) => s.botActions);
  const spectator = useGameStore((s) => s.spectator);
  const emotes = useGameStore((s) => s.emotes);
  const removeBot = useGameStore((s) => s.removeBot);

  const players = [...snapshot.players].sort((a, b) => a.seat - b.seat);
  const community = snapshot.community || [];
  const handNum = snapshot.handNumber || 0;
  const ended = !snapshot.inHand && snapshot.street === 'ended';

  // All-in runout pacing: only the cards dealt by the runout get the slow
  // reveal, and the winner is celebrated once the river has landed.
  const runoutFrom = typeof snapshot.runoutFrom === 'number' ? snapshot.runoutFrom : null;
  const isRunout = ended && runoutFrom !== null && community.length === 5;
  const [celebratedHand, setCelebratedHand] = useState(null);
  useEffect(() => {
    if (!isRunout) return undefined;
    const timer = setTimeout(() => setCelebratedHand(handNum), runoutSettleMs(runoutFrom));
    return () => clearTimeout(timer);
  }, [isRunout, handNum, runoutFrom]);
  const settled = !isRunout || celebratedHand === handNum;

  const payouts = snapshot.payouts || {};
  const isWinner = (p) => ended && settled && payouts[p.id] > 0;
  const result = ended && settled ? resultText(snapshot) : null;

  const shuffling = useTransientFlag(handNum, 700);
  const positions = layoutSeats(players, playerId);
  const canRemoveBots = !snapshot.inHand && !spectator.active;

  let message = ' ';
  if (result) message = result;
  else if (snapshot.inHand) message = t(`street.${snapshot.street}`);
  else if (handNum === 0) message = t('table.firstHand');

  return (
    <div className="table">
      <div className={`table__oval${shuffling ? ' table__oval--shuffle' : ''}`}>
        <div className="table__felt" aria-hidden="true" />

        <div className="table__center">
          <div className={`table__pot${snapshot.pot > 0 ? '' : ' table__pot--empty'}`} aria-live="polite">
            {snapshot.pot > 0 ? t('table.pot', { n: snapshot.pot.toLocaleString() }) : ' '}
          </div>
          <div className="table__board" role="group" aria-label={t('table.board')}>
            {Array.from({ length: 5 }).map((_, i) => {
              const card = community[i];
              if (!card)
                return <div key={`slot-${i}`} className="card card--md card--slot" aria-hidden="true" />;
              const slow = isRunout && i >= runoutFrom;
              return (
                <Card
                  key={card}
                  card={card}
                  className={slow ? 'card--flip card--slow' : 'card--flip'}
                  style={slow ? { animationDelay: `${revealDelay(i, runoutFrom)}s` } : undefined}
                />
              );
            })}
          </div>
          <div className={`table__message${result ? ' table__message--result' : ''}`} role="status">
            {message}
          </div>
        </div>

        {players.map((p, i) => {
          const bet = (p.contributions && p.contributions[snapshot.street]) || 0;
          if (!snapshot.inHand || bet <= 0 || p.hasFolded) return null;
          const pos = positions[i];
          return (
            <div key={`bet-${p.id}`} className="table__bet" style={{ '--sx': pos.x, '--sy': pos.y }}>
              <BetChips amount={bet} denominations={snapshot.chipDenominations || DENOMS} />
            </div>
          );
        })}

        {players.map((p, i) => (
          <Seat
            key={p.id}
            player={p}
            snapshot={snapshot}
            pos={positions[i]}
            isYou={p.id === playerId}
            isDealer={handNum > 0 && snapshot.dealerSeat === p.seat}
            isActing={snapshot.inHand && snapshot.nextActorId === p.id}
            isWinner={isWinner(p)}
            botAction={botActions[p.id] || null}
            emote={emotes[p.id] ? emotes[p.id].glyph : null}
            onRemoveBot={p.isBot && canRemoveBots ? removeBot : null}
          />
        ))}
      </div>
    </div>
  );
}
