import { useEffect, useRef, useState } from 'react';
import { parseDisplayCard } from '../cardUtils.js';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';
import HudOdds from './HudOdds.jsx';
import DealerButton from './DealerButton.jsx';
import StickFigure from './StickFigure.jsx';
import EmoteBar from './EmoteBar.jsx';
import ChipStack from './ChipStack.jsx';

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

function CommunityCard({ card, faceUp }) {
  if (!faceUp) {
    // Card back — deal-in (flies in from the deck) when a new card appears.
    return <div className="card card--back card--deal" />;
  }
  const { rank, suit, isRed } = parseDisplayCard(card);
  // Face-up — 3D flip-in when the street reveals.
  return (
    <div className={`card ${isRed ? 'card--red' : 'card--black'} card--flip`}>
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

function PlayerBadge({ player, street, isYou, isDealer, isNextActor, isWinner, botAction, snapshot, emote }) {
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
  const sortedPlayers = [...snapshot.players].sort((a, b) => a.seat - b.seat);
  const community = snapshot.community || [];
  const faceUp = ['flop', 'turn', 'river'].includes(snapshot.street);
  const communitySlots = 5;

  // Sprint 6 — resolve this hand's winner ids (for the winning pose).
  const lastWinners = (snapshot.lastShowdown && snapshot.lastShowdown.winnerIds) || [];
  const isWinner = (p) => lastWinners.includes(p.id);

  // Sprint 5 art pass: the table wiggles once and the pot glows when a new
  // hand starts (handNumber changes). useTransientFlag is inert on first
  // mount, so joining an in-progress table does NOT fake a shuffle.
  const handNum = snapshot.handNumber || 0;
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
