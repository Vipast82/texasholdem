import { useEffect, useRef, useState } from 'react';
import { parseDisplayCard } from '../cardUtils.js';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';
import HudOdds from './HudOdds.jsx';
import DealerButton from './DealerButton.jsx';
import StickFigure from './StickFigure.jsx';
import EmoteBar from './EmoteBar.jsx';
import ChipStack from './ChipStack.jsx';
import BetChips from './BetChips.jsx';

/**
 * Sprint 5 art pass — "is this card newly appearing?" helper.
 *
 * A CSS animation only plays when the element first mounts with that class.
 * React re-renders on every snapshot, so we track which (card, street) pairs
 * have already been seen and apply the animation class for one commit only,
 * removing it on the next render. This gives us:
 *   - deal-in animation when hole cards first appear
 *   - flip-in animation when community cards are revealed face-up
 *   - table shake when a new hand starts
 *   - pot glow on hand start
 * Without replaying on every re-render (bot actions, chip updates, etc.).
 */
function useTransientFlag(dep, durationMs = 800) {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  const prev = useRef(dep);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      prev.current = dep;
      return undefined;
    }
    if (dep === prev.current) return undefined;
    prev.current = dep;
    setOn(true);
    const timer = setTimeout(() => setOn(false), durationMs);
    return () => clearTimeout(timer);
  }, [dep, durationMs]);
  return on;
}

function streetLabel(street) {
  const key = `street.${street}`;
  const out = t(key);
  return out === key ? street : out;
}

/**
 * Runout (all-in / everyone matched) is a single server snapshot: the turn AND
 * river hit the board at once and the hand ends. Instead of showing both
 * instantly (and then the screen clearing), we reveal them on a slow,
 * cinematic beat. Delays are keyed by the community-card index (0-based) so the
 * flop (0-2) lands first, then the turn (~1.3 s), then the river (~2.4 s) —
 * giving a clear "flop … turn … river" cadence even though the server dealt
 * them in one move.
 */
const SLOW_REVEAL_DELAYS = [0, 0, 0, 1.3, 2.4];
/** Total time (ms) before the winner celebration plays on a slow runout
 *  (river lands at ~2.4s + its ~1s flip, so celebrate just after it settles). */
const RUNOUT_CELEBRATE_MS = 3200;

function CommunityCard({ card, faceUp, slowReveal, index }) {
  if (!faceUp) {
    // Card back — deal-in (flies in from the deck) when a new card appears.
    return <div className="card card--back card--deal" />;
  }
  const { rank, suit, isRed } = parseDisplayCard(card);
  // Face-up — 3D flip-in when the street reveals.
  // `slowReveal` gives the runout (all-in → turn + river) a cinematic stagger:
  // turn appears ~1.3 s after the flop, river ~2.5 s, so the player can watch
  // each card land before the showdown is decided.
  const cls = slowReveal ? 'card--flip card--slow-reveal' : 'card--flip';
  return (
    <div className={`card ${isRed ? 'card--red' : 'card--black'} ${cls}`} style={slowReveal ? { animationDelay: `${SLOW_REVEAL_DELAYS[index] || 0}s` } : undefined}>
      <span className="card__rank">{rank}</span>
      <span className="card__suit">{suit}</span>
    </div>
  );
}

function HoleCards({ cards }) {
  if (!cards || cards.length === 0) {
    return <div className="holecard holecard--hidden" />;
  }
  return (
    <div className="holecards">
      {cards.map((c, i) => {
        const { rank, suit, isRed } = parseDisplayCard(c);
        return (
          <div
            key={c}
            className={`card card--small ${isRed ? 'card--red' : 'card--black'} card--deal`}
            style={{ animationDelay: `${i * 0.12}s` }}
          >
            <span className="card__rank">{rank}</span>
            <span className="card__suit">{suit}</span>
          </div>
        );
      })}
    </div>
  );
}

function statusLabel(player, street) {
  if (player.hasFolded) return t('seat.folded');
  if (player.isAllIn) return t('seat.allin');
  const posted = (player.contributions && player.contributions[street]) || 0;
  return posted > 0 ? t('seat.posted', { n: posted }) : '—';
}

/**
 * Sprint 6 — derive a stick-figure pose from the player's live state.
 *   winning > allin > folded > acting > idle
 */
function poseFor(player, isNextActor, isWinner) {
  if (isWinner) return 'winning';
  if (player.isAllIn) return 'allin';
  if (player.hasFolded) return 'folded';
  if (isNextActor) return 'acting';
  return 'idle';
}

function PlayerBadge({ player, street, isYou, isDealer, isNextActor, isWinner, botAction, snapshot, emote, canRemoveBot, onRemoveBot }) {
  const pose = poseFor(player, isNextActor, isWinner);

  return (
    <div
      className={[
        'seat',
        player.isBot && 'seat--bot',
        isYou && 'seat--you',
        isNextActor && 'seat--acting',
        player.hasFolded && 'seat--folded',
        player.isAllIn && 'seat--allin',
        isWinner && 'seat--winning'
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="seat__figure">
        <StickFigure player={player} pose={pose} emote={emote} isMe={isYou} />
        {isDealer && <DealerButton active seat={player.name} />}
      </div>

      {/* Sprint 7 — bet chips: the amount posted THIS street as a growing,
          color-coded chip pile so the bet size is visible at a glance. */}
      {(player.contributions && (player.contributions[street] || 0) > 0) && !player.hasFolded && (
        <div className="seat__betchips">
          <BetChips amount={player.contributions[street]} denominations={snapshot.chipDenominations || [1, 5, 25, 100, 500]} />
        </div>
      )}

      <span className="seat__name">
        {player.name}
        {isYou && t('seat.you')}
        {player.isBot && (
          <span
            className="badge badge--bot"
            title={t('seat.botTitle', { difficulty: (player.bot && player.bot.difficulty) || 'normal' })}
          >
            🤖
          </span>
        )}
      </span>
      {player.isBot && canRemoveBot && (
        <button
          type="button"
          className="seat__removebot"
          aria-label={t('seat.removeBot', { name: player.name })}
          title={t('seat.removeBot', { name: player.name })}
          onClick={() => onRemoveBot(player.id)}
        >
          ✕
        </button>
      )}

      <HoleCards cards={player.holeCards} />
      <HudOdds snapshot={snapshot} playerId={player.id} />
      <div className="seat__stats">
        <ChipStack
          chips={player.chips}
          posted={(player.contributions && player.contributions[street]) || 0}
          denominations={snapshot.chipDenominations || [1, 5, 25, 100, 500]}
        />
        <span className="seat__status">{statusLabel(player, street)}</span>
      </div>
      {player.isBot && botAction && (
        <div className="seat__botnote" title={botAction.reason}>
          <strong>{botAction.action}</strong>
          {typeof botAction.confidence === 'number' && (
            <span className="seat__botconf">{Math.round(botAction.confidence * 100)}%</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function Table({ snapshot }) {
  const playerId = useGameStore((s) => s.playerId);
  const botActions = useGameStore((s) => s.botActions);
  const hud = useGameStore((s) => s.hud);
  const toggleHud = useGameStore((s) => s.toggleHud);
  const spectator = useGameStore((s) => s.spectator);
  const emotes = useGameStore((s) => s.emotes);
  const removeBot = useGameStore((s) => s.removeBot);
  const sortedPlayers = [...snapshot.players].sort((a, b) => a.seat - b.seat);
  const community = snapshot.community || [];
  const communitySlots = 5;
  const handNum = snapshot.handNumber || 0;

  // ---------------------------------------------------------------------------
  // Showdown pacing (all-in / runout + "hold after river")
  //
  // Two things were jarring with the raw snapshots:
  //   1. An all-in runout deals the turn AND river in ONE 'ended' snapshot, so
  //      the board flashed all at once.
  //   2. On 'ended' the old code set faceUp=false, so the final board flipped
  //      to backs and the screen "cleared" the instant the hand resolved.
  //
  // We fix both purely here (engine/server untouched):
  //   * keep the final board face-up and HOLD it until the dealer starts the
  //     next hand (faceUp is true for a live street OR an ended hand with cards);
  //   * for a runout, reveal the 5 cards on a slow beat and only fire the
  //     winner celebration AFTER the river lands.
  // ---------------------------------------------------------------------------
  const isEndedNow =
    !snapshot.inHand && (snapshot.street === 'ended' || snapshot.street === 'idle');
  const liveBoard = ['flop', 'turn', 'river'].includes(snapshot.street);
  const faceUp = liveBoard || (isEndedNow && community.length > 0);

  // Track, per hand, whether we ever SAW a live 'river' street. A hand that
  // jumps straight to an ended 5-card board without one is an all-in runout.
  // (Reading + latching a ref in render is safe here: every mutation is
  // idempotent, so React's double-invoke / re-render cannot desync it.)
  const paceRef = useRef({ hand: -1, sawRiver: false, runout: false });
  const pace = paceRef.current;
  if (handNum !== pace.hand) {
    pace.hand = handNum;
    pace.sawRiver = false;
    pace.runout = false;
  }
  if (liveBoard && snapshot.street === 'river') pace.sawRiver = true;
  if (isEndedNow && community.length === 5 && !pace.sawRiver) pace.runout = true;
  const isRunoutHand = pace.runout;

  // Winner celebration: instant for a normal hand; on a runout, wait for the
  // slow river reveal before the winner pops / the glow plays. `celebrateDelayed`
  // starts false so the FIRST runout render does not flash the winner early.
  const [celebrateDelayed, setCelebrateDelayed] = useState(false);
  useEffect(() => {
    if (!isRunoutHand) {
      setCelebrateDelayed(true);
      return undefined;
    }
    setCelebrateDelayed(false);
    const t = setTimeout(() => setCelebrateDelayed(true), RUNOUT_CELEBRATE_MS);
    return () => clearTimeout(t);
  }, [isRunoutHand, handNum]);
  const winnerVisible = isRunoutHand ? celebrateDelayed : true;

  // Sprint 6 — resolve this hand's winner ids (for the winning pose), gated by
  // the celebration timing so a runout winner pops only after the river lands.
  const lastWinners = (snapshot.lastShowdown && snapshot.lastShowdown.winnerIds) || [];
  const isWinner = (p) => winnerVisible && lastWinners.includes(p.id);

  // The runout's slow, per-card reveal (flop → turn → river) with staggered
  // delays (SLOW_REVEAL_DELAYS). Only active for an ended 5-card board.
  const slowReveal = isRunoutHand && isEndedNow && community.length === 5;

  // Sprint 5 art pass: the table wiggles once and the pot glows when a new
  // hand starts (handNumber changes). useTransientFlag is inert on first
  // mount, so joining an in-progress table does NOT fake a shuffle.
  const shuffling = useTransientFlag(handNum, 700);
  const potGlow = useTransientFlag(`${handNum}-pot`, 1300);

  const tableClass = ['table', 'table--saloon', shuffling && 'table--shuffling'].filter(Boolean).join(' ');

  return (
    <div className={tableClass}>
      <div className="table__topline">
        <span className="table__street">{streetLabel(snapshot.street)}</span>
        <label className="table__hudtoggle" title={t('hud.tip', { n: hud.iterations })}>
          <input type="checkbox" checked={hud.enabled} onChange={toggleHud} />
          <span>{t('hud.label')}</span>
        </label>
        {spectator.active && <span className="table__spectatorbadge">{t('spectator.badge')}</span>}
        <span className={`table__pot${potGlow ? ' table__pot--glow' : ''}`}>
          {t('table.pot', { n: snapshot.pot })}
        </span>
      </div>

      <div className="table__saloonbody">
        {/* Center of the oval: felt + community cards */}
        <div className="table__felt">
          <div className="table__community">
            {Array.from({ length: communitySlots }).map((_, i) => (
              <CommunityCard
                key={community[i] ? `${community[i]}-${snapshot.street}` : `empty-${i}`}
                card={community[i]}
                faceUp={faceUp && i < community.length}
                slowReveal={slowReveal}
                index={i}
              />
            ))}
          </div>
        </div>

        {/* Players arranged around the oval table */}
        <div className="table__players">
          {sortedPlayers.map((p) => (
            <PlayerBadge
              key={p.id}
              player={p}
              street={snapshot.street}
              isYou={p.id === playerId}
              isDealer={snapshot.dealerSeat === p.seat}
              isNextActor={snapshot.nextActorId === p.id}
              isWinner={isWinner(p)}
              botAction={botActions[p.id] || null}
              snapshot={snapshot}
              emote={emotes[p.id] ? emotes[p.id].glyph : null}
              canRemoveBot={!snapshot.inHand && !spectator.active}
              onRemoveBot={(botId) => { removeBot(botId); }}
            />
          ))}
        </div>
      </div>

      {/* Emote bar lives below the player's seat, anchored to the local player */}
      {playerId && <EmoteBar playerId={playerId} />}

      {snapshot.lastShowdown && (
        <div className="table__showdown">
          <strong>{t('table.showdown')}</strong> {snapshot.lastShowdown.ranked && snapshot.lastShowdown.ranked.cards
            ? snapshot.lastShowdown.ranked.cards.join(' ')
            : '—'}
        </div>
      )}
    </div>
  );
}
