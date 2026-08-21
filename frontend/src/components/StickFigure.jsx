import SeatAvatar from './SeatAvatar.jsx';
import { t } from '../i18n.js';

/**
 * StickFigure (Sprint 6) — a cartoon stick-figure body with the player's
 * avatar (SeatAvatar) as the head.  The body is an inline SVG; the head is the
 * existing SeatAvatar (circular, bounty-badge chrome) positioned over the
 * SVG's head area. Reusing SeatAvatar keeps the privacy model + crop handling
 * identical to Sprint 5.
 *
 * Poses (CSS class on the wrapper, driven by the `pose` prop):
 *   idle      – arms at sides, gentle sway
 *   acting    – right arm raised (beckoning "your turn")
 *   folded    – head bowed, arms tucked
 *   allin     – both arms spread wide
 *   winning   – both arms up + bounce animation
 *
 * The component is purely presentational: pose + emote are passed in.
 */
export default function StickFigure({ player, pose = 'idle', emote = null, isMe = false }) {
  const poseClass = ['stickfigure', `stickfigure--${pose}`].filter(Boolean).join(' ');

  return (
    <div
      className={poseClass}
      role="img"
      aria-label={t(
        player && player.name
          ? 'a11y.stickfigure'
          : 'a11y.stickfigure.default',
        player && player.name ? { name: player.name } : {}
      )}
    >
      {/* Emote bubble (rendered above the head) */}
      {emote && (
        <div className="stickfigure__emote" aria-hidden="true">
          {emote}
        </div>
      )}

      {/* Avatar head (SeatAvatar, circular, overlaid on the SVG head position) */}
      <div className="stickfigure__head">
        <SeatAvatar player={player} size={44} isMe={isMe} />
      </div>

      {/* Stick body (SVG). Arms are <g> groups rotated by pose classes. */}
      <svg className="stickfigure__body" viewBox="0 0 100 100" fill="none" aria-hidden="true">
        {/* Torso */}
        <line x1="50" y1="14" x2="50" y2="58" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
        {/* Left arm (pivot at shoulder 50,24) */}
        <g className="sf-arm sf-arm--left" style={{ transformOrigin: '50px 24px' }}>
          <line x1="50" y1="24" x2="28" y2="54" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <circle cx="28" cy="54" r="3.5" fill="currentColor" />
        </g>
        {/* Right arm (pivot at shoulder 50,24) */}
        <g className="sf-arm sf-arm--right" style={{ transformOrigin: '50px 24px' }}>
          <line x1="50" y1="24" x2="72" y2="54" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <circle cx="72" cy="54" r="3.5" fill="currentColor" />
        </g>
        {/* Left leg */}
        <line x1="50" y1="58" x2="34" y2="96" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        <circle cx="34" cy="96" r="3.5" fill="currentColor" />
        {/* Right leg */}
        <line x1="50" y1="58" x2="66" y2="96" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        <circle cx="66" cy="96" r="3.5" fill="currentColor" />
      </svg>
    </div>
  );
}