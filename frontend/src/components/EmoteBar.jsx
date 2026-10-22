import { EMOTES } from '../services/emoteService.js';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';

/**
 * EmoteBar (Sprint 6) — a row of emote buttons the player can click to
 * show an emote above their stick figure.  Local-only: no server round-trip.
 */
export default function EmoteBar({ playerId }) {
  const sendEmote = useGameStore((s) => s.sendEmote);

  const onEmote = (code) => {
    if (playerId) sendEmote(playerId, code);
  };

  return (
    <div className="emotebar" role="toolbar" aria-label={t('emote.title')}>
      <span className="emotebar__label">{t('emote.title')}</span>
      <div className="emotebar__buttons">
        {EMOTES.map((e) => (
          <button
            key={e.code}
            className="emotebar__btn"
            title={t(e.label_key)}
            onClick={() => onEmote(e.code)}
            aria-label={t(e.label_key)}
          >
            {e.glyph}
          </button>
        ))}
      </div>
    </div>
  );
}
