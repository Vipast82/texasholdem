import { useMemo } from 'react';
import { equityForPlayer } from '@saloon/shared/equity';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';

function pct(x) {
  return `${Math.round((x || 0) * 100)}%`;
}

/**
 * HUD equity chip (Sprint 4): a per-seat win/tie/lose estimate.
 *
 * The estimate is computed CLIENT-SIDE from this viewer's snapshot by the single
 * shared Monte-Carlo (`equityForPlayer` wraps the one `estimateWinTieLose`).
 * It is always null-safe: when the seat's hole cards are not in this snapshot
 * (a live player can only ever see their own; a spectator sees all), it renders
 * nothing — privacy is preserved by the snapshot itself, not here.
 */
export default function HudOdds({ snapshot, playerId }) {
  const hud = useGameStore((s) => s.hud);

  const equity = useMemo(() => {
    if (!hud.enabled || !snapshot || !playerId) return null;
    // Deterministic seed: same table + hand + street + seat => same estimate.
    const seed = [snapshot.tableId, snapshot.handNumber, snapshot.street, playerId].join(':');
    return equityForPlayer(snapshot, playerId, seed, hud.iterations);
  }, [hud.enabled, hud.iterations, snapshot, playerId]);

  if (!equity) return null;

  return (
    <div
      className="hud"
      title={`${t('hud.tie')} ${pct(equity.tie)} · ${t('hud.lose')} ${pct(equity.lose)} — ${t('hud.tip', { n: equity.iterations })}`}
    >
      {t('hud.win')} {pct(equity.win)}
    </div>
  );
}
