import { useEffect } from 'react';
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

/**
 * Hand-history panel (Sprint 4): lists finished hands (newest first), with a
 * "Export JSON" action (Blob download of the server-serialized record) and an
 * auto-persist toggle. Records arrive two ways: the live `handRecord` broadcast
 * and an explicit `loadHistory` on mount (for a fresh page load).
 */
/** Total chips the winners took from the pot. */
function amountWon(record) {
  const payouts = record.payouts || {};
  return Object.values(payouts).reduce((sum, n) => sum + (Number(n) || 0), 0);
}

export default function HistoryPanel() {
  const tableId = useGameStore((s) => s.tableId);
  const records = useGameStore((s) => s.history.records);
  const locale = useGameStore((s) => s.tutorial.locale);
  const loadHistory = useGameStore((s) => s.loadHistory);
  const exportHistory = useGameStore((s) => s.exportHistory);

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
      {records.length === 0 ? (
        <p className="empty">{t('history.empty')}</p>
      ) : (
        <ol className="history__list">
          {records.slice(0, 30).map((rec) => {
            const win = winningHandOf(rec);
            const handName = win && win.category != null ? categoryName(win.category, locale || 'en') : null;
            return (
              <li key={`${rec.tableId}-${rec.handNumber}-${rec.ts}`} className="history__item">
                <div className="history__line">
                  <span className="history__num">#{rec.handNumber}</span>
                  <span className="history__win">
                    {t('history.won', { name: winnerNames(rec), n: amountWon(rec).toLocaleString() })}
                  </span>
                </div>
                <div className="history__detail">
                  {handName || (rec.reason ? t(`history.reason.${rec.reason}`) : '')}
                </div>
                {win ? (
                  <CardRow cards={win.cards} titlePrefix={handName || ''} />
                ) : (
                  Array.isArray(rec.board) &&
                  rec.board.length > 0 && <CardRow cards={rec.board} titlePrefix={t('history.board')} />
                )}
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
