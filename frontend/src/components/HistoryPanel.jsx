import { useEffect } from 'react';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';

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
 * Hand-history panel (Sprint 4): lists finished hands (newest first), with a
 * "Export JSON" action (Blob download of the server-serialized record) and an
 * auto-persist toggle. Records arrive two ways: the live `handRecord` broadcast
 * and an explicit `loadHistory` on mount (for a fresh page load).
 */
export default function HistoryPanel() {
  const tableId = useGameStore((s) => s.tableId);
  const records = useGameStore((s) => s.history.records);
  const autoPersist = useGameStore((s) => s.history.autoPersist);
  const loadHistory = useGameStore((s) => s.loadHistory);
  const exportHistory = useGameStore((s) => s.exportHistory);
  const setAutoPersist = useGameStore((s) => s.setAutoPersist);

  // On first attach to a table, pull the server's stored history ring.
  useEffect(() => {
    if (tableId) loadHistory(tableId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  const onExport = async () => {
    const json = await exportHistory(tableId);
    if (!json) return;
    download(`saloon-history-${tableId || 'all'}.json`, json);
  };

  return (
    <section className="history" aria-label={t('history.title')}>
      <div className="history__head">
        <h2>{t('history.title')}</h2>
        <div className="history__tools">
          <label className="history__toggle">
            <input
              type="checkbox"
              checked={autoPersist}
              onChange={(e) => setAutoPersist(e.target.checked)}
            />
            <span>{t('history.autoPersist')}</span>
          </label>
          <button className="btn btn--ghost" onClick={onExport} disabled={records.length === 0}>
            {t('history.export')}
          </button>
        </div>
      </div>

      {records.length === 0 ? (
        <p className="history__empty">{t('history.empty')}</p>
      ) : (
        <ol className="history__list">
          {records.slice(0, 30).map((rec, i) => (
            <li key={`${rec.tableId}-${rec.handNumber}-${i}`} className="history__item">
              <div className="history__meta">
                <strong>#{rec.handNumber}</strong>
                <span className="history__board">{(rec.board || []).join(' ') || t('history.noBoard')}</span>
              </div>
              <div className="history__win">
                {t('history.winner')}: <strong>{winnerNames(rec)}</strong>
              </div>
              <div className="history__reason">{rec.reason ? t(`history.reason.${rec.reason}`, { reason: rec.reason }) : ''}</div>
            </li>
          ))}
        </ol>
      )}
      <p className="history__note">{t('history.note')}</p>
    </section>
  );
}