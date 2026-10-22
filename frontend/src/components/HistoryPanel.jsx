import { useEffect, useState } from 'react';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';
import { CardRow } from './CardTile.jsx';
import { categoryName } from '@saloon/shared';

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function winnerNames(record) {
  if (!record || !Array.isArray(record.players) || !Array.isArray(record.winnerIds)) return '—';
  const byId = new Map(record.players.map((p) => [p.id, p.name]));
  const names = record.winnerIds.map((id) => byId.get(id) || id);
  return names.length ? names.join(', ') : '—';
}

/**
 * Resolve the winner's best five-card hand (and its category name) from a hand
 * record. Prefers the showdown `rankedHand`; for a fold-out there is no ranked
 * hand, so we fall back to the winner's own `bestHand` (if recorded) or null.
 * @returns {{ cards: string[], category: (number|null) } | null}
 */
function winningHandOf(record) {
  if (!record) return null;
  const ranked = record.rankedHand;
  if (ranked && Array.isArray(ranked.cards) && ranked.cards.length >= 5) {
    return { cards: ranked.cards.slice(0, 5), category: ranked.category != null ? ranked.category : null };
  }
  if (Array.isArray(record.winnerIds) && Array.isArray(record.players)) {
    const winner = record.players.find((p) => record.winnerIds.includes(p.id) && p.bestHand);
    if (
      winner &&
      winner.bestHand &&
      Array.isArray(winner.bestHand.cards) &&
      winner.bestHand.cards.length >= 5
    ) {
      return {
        cards: winner.bestHand.cards.slice(0, 5),
        category: winner.bestHand.category != null ? winner.bestHand.category : null
      };
    }
  }
  return null;
}

/** Total chips the winners took from the pot. */
function amountWon(record) {
  const payouts = record.payouts || {};
  return Object.values(payouts).reduce((sum, n) => sum + (Number(n) || 0), 0);
}

const STREETS = ['preflop', 'flop', 'turn', 'river'];

/** Every action of one hand, grouped by betting round. */
function HandActions({ record }) {
  const nameOf = new Map((record.players || []).map((p) => [p.id, p.name]));
  return (
    <div className="history__actions">
      {STREETS.map((street) => {
        const acts = (record.actions || []).filter((a) => a.street === street);
        if (!acts.length) return null;
        return (
          <div key={street} className="history__street">
            <span className="history__streetname">{t(`street.${street}`)}</span>
            <span>
              {acts
                .map((a) =>
                  a.amount > 0 && a.action !== 'fold'
                    ? `${nameOf.get(a.playerId) || '?'} ${t(`action.${a.action}`).toLowerCase()} ${a.amount.toLocaleString()}`
                    : `${nameOf.get(a.playerId) || '?'} ${t(`action.${a.action}`).toLowerCase()}`
                )
                .join(' · ')}
            </span>
          </div>
        );
      })}
      {(record.players || [])
        .filter((p) => Array.isArray(p.holeCards))
        .map((p) => (
          <div key={p.id} className="history__shown">
            <span>{p.name}</span>
            <CardRow cards={p.holeCards} titlePrefix={p.name} />
          </div>
        ))}
    </div>
  );
}

/** Results at this table so far, best first. */
function TableResults() {
  const snapshot = useGameStore((s) => s.snapshot);
  const playerId = useGameStore((s) => s.playerId);
  if (!snapshot || !snapshot.session) return null;
  const rows = snapshot.players
    .map((p) => ({ ...p, ...(snapshot.session[p.id] || { handsWon: 0, biggestPot: 0, net: 0 }) }))
    .sort((a, b) => b.net - a.net);
  return (
    <div className="results">
      <h3 className="results__title">{t('history.tableResults')}</h3>
      <table className="results__table">
        <thead>
          <tr>
            <th scope="col">{t('history.player')}</th>
            <th scope="col">{t('history.net')}</th>
            <th scope="col">{t('history.won.short')}</th>
            <th scope="col">{t('history.biggest')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.id === playerId ? 'results__me' : undefined}>
              <td>{r.name}</td>
              <td className={r.net > 0 ? 'results__up' : r.net < 0 ? 'results__down' : undefined}>
                {r.net > 0 ? '+' : ''}
                {r.net.toLocaleString()}
              </td>
              <td>{r.handsWon}</td>
              <td>{r.biggestPot ? r.biggestPot.toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Your lifetime record (kept on this device). */
function LifetimeRecord() {
  const profile = useGameStore((s) => s.profile);
  const stats = profile.stats || {};
  return (
    <p className="results__life">
      {t('history.lifetime', {
        hands: (profile.handCount || 0).toLocaleString(),
        won: (stats.handsWon || 0).toLocaleString(),
        biggest: (stats.biggestPot || 0).toLocaleString(),
        tournaments: stats.tournamentsWon || 0
      })}
    </p>
  );
}

export default function HistoryPanel() {
  const tableId = useGameStore((s) => s.tableId);
  const records = useGameStore((s) => s.history.records);
  const locale = useGameStore((s) => s.tutorial.locale);
  const loadHistory = useGameStore((s) => s.loadHistory);
  const exportHistory = useGameStore((s) => s.exportHistory);
  const [open, setOpen] = useState(null);

  // On first attach to a table, pull the server's stored history ring.
  useEffect(() => {
    if (tableId) loadHistory(tableId);
  }, [tableId, loadHistory]);

  const onExport = async () => {
    const json = await exportHistory(tableId);
    if (!json) return;
    download(`saloon-history-${tableId || 'all'}.json`, json);
  };

  return (
    <section className="history" aria-label={t('history.title')}>
      <TableResults />
      <LifetimeRecord />
      <h3 className="results__title">{t('history.hands')}</h3>
      {records.length === 0 ? (
        <p className="empty">{t('history.empty')}</p>
      ) : (
        <ol className="history__list">
          {records.slice(0, 30).map((rec) => {
            const key = `${rec.tableId}-${rec.handNumber}-${rec.ts}`;
            const win = winningHandOf(rec);
            const handName = win && win.category != null ? categoryName(win.category, locale || 'en') : null;
            const expanded = open === key;
            return (
              <li key={key} className={`history__item${expanded ? ' history__item--open' : ''}`}>
                <button
                  type="button"
                  className="history__toggle"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : key)}
                >
                  <span className="history__line">
                    <span className="history__num">#{rec.handNumber}</span>
                    <span className="history__win">
                      {t('history.won', { name: winnerNames(rec), n: amountWon(rec).toLocaleString() })}
                    </span>
                  </span>
                  <span className="history__detail">
                    {handName || (rec.reason ? t(`history.reason.${rec.reason}`) : '')}
                  </span>
                </button>
                {win ? (
                  <CardRow cards={win.cards} titlePrefix={handName || ''} />
                ) : (
                  Array.isArray(rec.board) &&
                  rec.board.length > 0 && <CardRow cards={rec.board} titlePrefix={t('history.board')} />
                )}
                {expanded && <HandActions record={rec} />}
              </li>
            );
          })}
        </ol>
      )}
      <div className="history__foot">
        <p className="note">{t('history.note')}</p>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onExport}
          disabled={records.length === 0}
        >
          {t('history.export')}
        </button>
      </div>
    </section>
  );
}
