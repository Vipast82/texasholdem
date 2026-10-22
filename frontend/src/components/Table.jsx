import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { categoryName } from '@saloon/shared';
import { parseDisplayCard } from '../cardUtils.js';
import { useGameStore } from '../store.js';
import { t, getLocale } from '../i18n.js';
import { stadiumPath, seatSpots } from '../tableGeometry.js';
import { useNow, remainingMs } from '../hooks.js';
import { sfxService } from '../services/sfxService.js';
import HudOdds from './HudOdds.jsx';
import DealerButton from './DealerButton.jsx';
import SeatAvatar from './SeatAvatar.jsx';
import BetChips from './BetChips.jsx';

const DENOMS = [1, 5, 25, 100, 500];

/** Live pixel size of an element (falls back to a sensible default in tests). */
function useBoxSize(ref) {
  const [size, setSize] = useState({ w: 1000, h: 480 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Turn `on` for `durationMs` whenever `dep` changes (never on first mount). */
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
 * All-in runouts deal the rest of the board in one server update; reveal those
 * cards on a slow beat (turn, then river). Delays in seconds by board position.
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
  const suitClass = `card--${card.slice(-1)}`;
  return (
    <div
      className={`card card--${size} ${isRed ? 'card--red' : 'card--black'} ${suitClass} ${className}`}
      style={style}
    >
      <span className="card__corner">
        <span className="card__rank">{rank}</span>
        <span className="card__pip">{suit}</span>
      </span>
      <span className="card__suit">{suit}</span>
    </div>
  );
}

function CardBack({ size = 'sm', className = '' }) {
  return <div className={`card card--${size} card--back ${className}`} aria-hidden="true" />;
}

/** Felt colour choices: [centre, middle, edge] of the radial gradient. */
const FELT_COLORS = {
  green: ['#2f8a5f', '#1d6044', '#0f3a29'],
  blue: ['#2f6f9f', '#1d4a72', '#0e2a45'],
  red: ['#9c3a31', '#70241d', '#40120e'],
  purple: ['#6b4290', '#4a2b66', '#29163a'],
  black: ['#3c3c3a', '#262624', '#121211']
};

/** The table drawn as layered SVG: shadow, wooden apron, leather rail, brass studs, felt. */
function TableArt({ w, h, felt: feltName = 'green' }) {
  const [c0, c1, c2] = FELT_COLORS[feltName] || FELT_COLORS.green;
  const rail = Math.max(14, Math.min(w, h) * 0.065);
  const apron = Math.max(6, h * 0.028);
  const outer = stadiumPath(w, h - apron, 0);
  const studs = stadiumPath(w, h - apron, rail * 0.5);
  const felt = stadiumPath(w, h - apron, rail);
  const line = stadiumPath(w, h - apron, rail + Math.min(w, h) * 0.13);
  return (
    <svg
      className="table__art"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="felt" cx="50%" cy="42%" r="65%">
          <stop offset="0%" stopColor={c0} />
          <stop offset="55%" stopColor={c1} />
          <stop offset="100%" stopColor={c2} />
        </radialGradient>
        <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5a3820" />
          <stop offset="45%" stopColor="#3a2213" />
          <stop offset="100%" stopColor="#24140b" />
        </linearGradient>
        <linearGradient id="apron" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a170c" />
          <stop offset="100%" stopColor="#140a05" />
        </linearGradient>
        <filter id="tableShadow" x="-10%" y="-10%" width="120%" height="140%">
          <feGaussianBlur stdDeviation={Math.max(8, h * 0.035)} />
        </filter>
        <filter id="feltShade" x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation={rail * 0.35} />
        </filter>
        <clipPath id="feltClip">
          <path d={felt} />
        </clipPath>
      </defs>

      <path
        d={outer}
        transform={`translate(0 ${apron * 2.2})`}
        fill="rgba(0,0,0,0.55)"
        filter="url(#tableShadow)"
      />
      <path d={outer} transform={`translate(0 ${apron})`} fill="url(#apron)" />
      <path d={outer} fill="url(#rail)" stroke="#120904" strokeWidth="1.5" />
      <path
        d={studs}
        fill="none"
        stroke="#d2a54c"
        strokeWidth={Math.max(2.5, rail * 0.18)}
        strokeLinecap="round"
        strokeDasharray={`0 ${Math.max(12, rail * 1.1)}`}
        opacity="0.9"
      />
      <path d={felt} fill="url(#felt)" />
      {/* Inner shadow where the felt meets the rail. */}
      <g clipPath="url(#feltClip)">
        <path
          d={felt}
          fill="none"
          stroke="rgba(0,0,0,0.55)"
          strokeWidth={rail * 0.9}
          filter="url(#feltShade)"
        />
      </g>
      <path d={line} fill="none" stroke="rgba(242,232,213,0.1)" strokeWidth="1.5" />
      <text
        className="table__brand"
        x={w / 2}
        y={(h - apron) * 0.74}
        textAnchor="middle"
        fontSize={Math.max(14, Math.min(w * 0.032, 34))}
      >
        ★ Saloon Hold&apos;em ★
      </text>
    </svg>
  );
}

/** Shot clock: a ring around the acting player's portrait that runs down. */
function TurnRing({ remaining, total }) {
  const from = Math.min(100, Math.max(0, (1 - remaining / total) * 100));
  return (
    <svg className="turnring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle
        cx="50"
        cy="50"
        r="47"
        pathLength="100"
        style={{ '--from': from, animationDuration: `${remaining}ms` }}
      />
    </svg>
  );
}

function seatStatus(player, snapshot, lastAction) {
  if (player.sittingOut) return t('seat.sittingOut');
  if (player.chips === 0 && !player.isAllIn && player.status !== 'in-hand') return t('seat.busted');
  if (!snapshot.inHand) return null;
  if (player.hasFolded) return t('seat.folded');
  if (player.isAllIn) return t('seat.allin');
  if (lastAction) return t(`action.${lastAction.action}`);
  return null;
}

function Seat({
  player,
  snapshot,
  spot,
  isYou,
  isDealer,
  isActing,
  winAmount,
  lastAction,
  emote,
  speech,
  highlight,
  onRemoveBot,
  avatarSize,
  turn,
  shownHand
}) {
  const inHand = player.status === 'in-hand';
  const folded = player.hasFolded && snapshot.inHand;
  const hasCards = Array.isArray(player.holeCards) && player.holeCards.length === 2;
  // Keep the last hand's cards on screen until the next deal.
  const dealtIn = inHand || (snapshot.street === 'ended' && hasCards);
  const status = seatStatus(player, snapshot, lastAction);
  const cardSize = isYou ? 'lg' : hasCards ? 'sm' : 'xs';

  return (
    <div
      className={[
        'seat',
        `seat--${spot.side}`,
        isYou && 'seat--you',
        isActing && 'seat--acting',
        folded && 'seat--folded',
        player.chips === 0 && !inHand && 'seat--out',
        winAmount > 0 && 'seat--winner'
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ left: spot.x, top: spot.y }}
    >
      <div className="seat__avatar">
        <SeatAvatar player={player} size={avatarSize} isMe={isYou} />
        {speech ? (
          <span className="seat__speech" aria-hidden="true">
            {speech}
          </span>
        ) : (
          emote && (
            <span className="seat__emote" aria-hidden="true">
              {emote}
            </span>
          )
        )}
        {isDealer && <DealerButton active seat={player.name} />}
        {turn && <TurnRing key={turn.key} remaining={turn.remaining} total={turn.total} />}
      </div>

      {dealtIn && !folded && (
        <div className="seat__cards">
          {hasCards
            ? player.holeCards.map((c, i) => (
                <Card
                  key={c}
                  card={c}
                  size={cardSize}
                  className={`card--deal${highlight ? (highlight.has(c) ? ' card--win' : ' card--dim') : ''}`}
                  style={{ animationDelay: `${i * 0.12}s` }}
                />
              ))
            : [0, 1].map((i) => <CardBack key={i} size={cardSize} className="card--deal" />)}
        </div>
      )}

      <div className="seat__plate">
        <span className="seat__name">
          <span className="seat__nametext">{player.name}</span>
          {player.isBot && (
            <span
              className="seat__bot"
              title={t('seat.botTitle', {
                difficulty: t(`difficulty.${(player.bot && player.bot.difficulty) || 'normal'}`),
                style: t(`style.${(player.bot && player.bot.style) || 'tight-aggressive'}`)
              })}
            >
              {t('seat.cpu')}
            </span>
          )}
        </span>
        <span className="seat__stack">{player.chips.toLocaleString()}</span>
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

      {winAmount > 0 && <span className="seat__tag seat__tag--win">+{winAmount.toLocaleString()}</span>}
      {shownHand && <span className="seat__tag seat__tag--hand">{shownHand}</span>}
      {!winAmount && !shownHand && status && <span className="seat__tag">{status}</span>}
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

/**
 * Chips in motion: when a betting round closes, each bet slides into the pot;
 * when the hand is decided, the pot slides to the winner(s). Returns the
 * flights to draw (each plays a short CSS animation and then expires).
 */
function useChipFlights(snapshot, players, spots, pot, payouts, settled) {
  const [flights, setFlights] = useState([]);
  const roundKey = `${snapshot.handNumber}:${snapshot.street}`;
  const winners = Object.keys(payouts).filter((id) => payouts[id] > 0);
  const payKey = settled && winners.length ? `${snapshot.handNumber}:paid` : null;

  // The latest positions, read by the effects below when a round closes.
  const latestRef = useRef(null);
  const betsRef = useRef({ key: null, bets: [] });
  const paidRef = useRef(null);
  useEffect(() => {
    latestRef.current = { players, spots, pot, payouts };
    const bets = players
      .map((p, i) => ({
        id: p.id,
        amount: (p.contributions && p.contributions[snapshot.street]) || 0,
        x: spots[i] ? spots[i].betX : 0,
        y: spots[i] ? spots[i].betY : 0
      }))
      .filter((bet) => snapshot.inHand && bet.amount > 0);
    if (betsRef.current.key === roundKey) betsRef.current.bets = bets;
  });

  // A betting round closed: last round's bets slide into the pot.
  useEffect(() => {
    const last = betsRef.current;
    const center = latestRef.current ? latestRef.current.pot : { x: 0, y: 0 };
    betsRef.current = { key: roundKey, bets: [] };
    if (!last.key || !last.bets.length) return undefined;
    const batch = last.bets.map((bet) => ({
      key: `in-${last.key}-${bet.id}`,
      kind: 'in',
      amount: bet.amount,
      x0: bet.x,
      y0: bet.y,
      x1: center.x,
      y1: center.y
    }));
    const show = setTimeout(() => setFlights((fl) => [...fl, ...batch]), 0);
    const hide = setTimeout(() => setFlights((fl) => fl.filter((x) => !batch.includes(x))), 650);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [roundKey]);

  // The hand is decided: the pot slides to the winner(s).
  useEffect(() => {
    if (!payKey || paidRef.current === payKey || !latestRef.current) return undefined;
    paidRef.current = payKey;
    const { players: ps, spots: sp, pot: center, payouts: pay } = latestRef.current;
    const batch = Object.keys(pay)
      .filter((id) => pay[id] > 0)
      .map((id) => {
        const i = ps.findIndex((p) => p.id === id);
        if (i < 0 || !sp[i]) return null;
        return {
          key: `out-${payKey}-${id}`,
          kind: 'out',
          amount: pay[id],
          x0: center.x,
          y0: center.y,
          x1: sp[i].x,
          y1: sp[i].y
        };
      })
      .filter(Boolean);
    const show = setTimeout(() => {
      setFlights((fl) => [...fl, ...batch]);
      try {
        sfxService.play('chips');
      } catch (err) {
        // sound is best-effort
      }
    }, 250);
    const hide = setTimeout(() => setFlights((fl) => fl.filter((x) => !batch.includes(x))), 1250);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [payKey]);

  return flights;
}

export default function Table({ snapshot }) {
  const playerId = useGameStore((s) => s.playerId);
  const actions = useGameStore((s) => s.actions);
  const spectator = useGameStore((s) => s.spectator);
  const emotes = useGameStore((s) => s.emotes);
  const speech = useGameStore((s) => s.speech);
  const removeBot = useGameStore((s) => s.removeBot);
  const snapshotAt = useGameStore((s) => s.snapshotAt);
  const felt = useGameStore((s) => s.profile.settings.felt);
  const boxRef = useRef(null);
  const { w, h } = useBoxSize(boxRef);

  const players = [...snapshot.players].sort((a, b) => a.seat - b.seat);
  const community = snapshot.community || [];
  const handNum = snapshot.handNumber || 0;
  const ended = !snapshot.inHand && snapshot.street === 'ended';

  // All-in runout pacing: only the runout's cards get the slow reveal, and the
  // winner is celebrated once the river has landed.
  const runoutFrom = typeof snapshot.runoutFrom === 'number' ? snapshot.runoutFrom : null;
  const isRunout = ended && runoutFrom !== null && community.length === 5;
  const [celebratedHand, setCelebratedHand] = useState(null);
  useEffect(() => {
    if (!isRunout) return undefined;
    const timer = setTimeout(() => setCelebratedHand(handNum), runoutSettleMs(runoutFrom));
    return () => clearTimeout(timer);
  }, [isRunout, handNum, runoutFrom]);
  const settled = !isRunout || celebratedHand === handNum;

  const payouts = (ended && settled && snapshot.payouts) || {};
  const result = ended && settled ? resultText(snapshot) : null;
  // At showdown, light up the five cards that made the winning hand.
  const ranked = ended && settled && snapshot.lastShowdown && snapshot.lastShowdown.ranked;
  const highlight = ranked && Array.isArray(ranked.cards) ? new Set(ranked.cards) : null;

  const shuffling = useTransientFlag(handNum, 700);

  // Countdowns (shot clock, next deal) tick locally from the last snapshot.
  const now = useNow(!!(snapshot.turn || snapshot.nextHandIn != null));
  const nextIn = remainingMs(snapshot.nextHandIn, snapshotAt, now);
  const turnLeft = snapshot.turn ? remainingMs(snapshot.turn.remainingMs, snapshotAt, now) : null;
  const turnKey = snapshot.turn
    ? `${snapshot.turn.playerId}:${Math.round((snapshotAt + snapshot.turn.remainingMs) / 500)}`
    : null;
  const meIndex = Math.max(
    0,
    players.findIndex((p) => p.id === playerId)
  );
  const apron = Math.max(6, h * 0.028);
  const spots = seatSpots(players.length, w, h - apron, meIndex, {
    inset: Math.max(14, Math.min(w, h) * 0.065) * 0.5
  });
  const compact = w < 640;
  const canRemoveBots = !snapshot.inHand && !spectator.active;

  // Showdown: name every hand that was turned face up.
  const shown = ended && settled && snapshot.lastShowdown && snapshot.lastShowdown.all;
  const shownHandOf = (id) => (shown && shown[id] ? categoryName(shown[id].category, getLocale()) : null);

  const potCenter = { x: w / 2, y: (h - apron) * 0.46 - Math.max(38, Math.min(w * 0.06, 80)) * 0.95 };
  const flights = useChipFlights(snapshot, players, spots, potCenter, payouts, settled);

  let message = '\u00a0';
  if (result) message = result;
  else if (snapshot.inHand) message = t(`street.${snapshot.street}`);
  else if (nextIn != null) message = t('table.nextHand', { n: Math.ceil(nextIn / 1000) });
  else if (handNum === 0) message = t('table.firstHand');
  const pots = Array.isArray(snapshot.pots) ? snapshot.pots : [];

  return (
    <div className={`table${compact ? ' table--compact' : ''}`}>
      <div
        ref={boxRef}
        className={`table__box${shuffling ? ' table__box--shuffle' : ''}`}
        style={{ '--cw': `${Math.round(Math.max(w < 640 ? 30 : 38, Math.min(w * 0.06, 80)))}px` }}
      >
        <TableArt w={w} h={h} felt={felt} />

        <div className="table__center" style={{ top: (h - apron) * 0.46 }}>
          <div className={`table__pot${snapshot.pot > 0 ? '' : ' table__pot--empty'}`} aria-live="polite">
            <span className="table__potchip" aria-hidden="true" />
            {t('table.pot', { n: snapshot.pot.toLocaleString() })}
          </div>
          {pots.length > 1 && (
            <div className="table__pots">
              {pots.map((p, i) => (
                <span key={i} className="table__sidepot">
                  {t(i === 0 ? 'table.mainPot' : 'table.sidePot', { n: p.amount.toLocaleString() })}
                </span>
              ))}
            </div>
          )}
          <div className="table__board" role="group" aria-label={t('table.board')}>
            {Array.from({ length: 5 }).map((_, i) => {
              const card = community[i];
              if (!card)
                return <div key={`slot-${i}`} className="card card--md card--slot" aria-hidden="true" />;
              const slow = isRunout && i >= runoutFrom;
              const glow = highlight ? (highlight.has(card) ? ' card--win' : ' card--dim') : '';
              return (
                <Card
                  key={card}
                  card={card}
                  className={`${slow ? 'card--flip card--slow' : 'card--flip'}${glow}`}
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
          return (
            <div
              key={`bet-${p.id}`}
              className="table__bet"
              style={{ left: spots[i].betX, top: spots[i].betY }}
            >
              <BetChips amount={bet} denominations={snapshot.chipDenominations || DENOMS} />
            </div>
          );
        })}

        {flights.map((fl) => (
          <div
            key={fl.key}
            className={`chipflight chipflight--${fl.kind}`}
            style={{ '--x0': `${fl.x0}px`, '--y0': `${fl.y0}px`, '--x1': `${fl.x1}px`, '--y1': `${fl.y1}px` }}
            aria-hidden="true"
          >
            <BetChips amount={fl.amount} denominations={snapshot.chipDenominations || DENOMS} />
          </div>
        ))}

        {players.map((p, i) => (
          <Seat
            key={p.id}
            player={p}
            snapshot={snapshot}
            spot={spots[i]}
            isYou={p.id === playerId}
            isDealer={handNum > 0 && snapshot.dealerSeat === p.seat}
            isActing={snapshot.inHand && snapshot.nextActorId === p.id}
            winAmount={payouts[p.id] || 0}
            lastAction={actions[p.id] || null}
            emote={emotes[p.id] ? emotes[p.id].glyph : null}
            speech={speech[p.id] ? speech[p.id].text : null}
            highlight={highlight}
            onRemoveBot={p.isBot && canRemoveBots ? removeBot : null}
            avatarSize={p.id === playerId ? (compact ? 44 : 64) : compact ? 36 : 52}
            turn={
              snapshot.turn && snapshot.turn.playerId === p.id && turnLeft != null
                ? { key: turnKey, remaining: turnLeft, total: snapshot.turn.totalMs }
                : null
            }
            shownHand={shownHandOf(p.id)}
          />
        ))}
      </div>
    </div>
  );
}
