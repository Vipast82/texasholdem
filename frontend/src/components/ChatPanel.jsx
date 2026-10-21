import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';

export default function ChatPanel() {
  const chat = useGameStore((s) => s.chat);
  const sendChat = useGameStore((s) => s.sendChat);
  const [text, setText] = useState('');
  const logRef = useRef(null);

  // Keep the newest message in view (scroll the log, not the whole page).
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chat]);

  const submit = (e) => {
    e.preventDefault();
    const msg = text.trim();
    if (!msg) return;
    sendChat(msg);
    setText('');
  };

  return (
    <div className="chat">
      <div
        className="chat__log"
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t('chat.title')}
      >
        {chat.length === 0 && <p className="empty">{t('chat.empty')}</p>}
        {chat.map((m) => (
          <p key={`${m.ts}-${m.from}`} className="chat__msg">
            <span className="chat__from">{m.from}</span> {m.text}
          </p>
        ))}
      </div>
      <form className="chat__form" onSubmit={submit}>
        <input
          aria-label={t('chat.placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('chat.placeholder')}
          maxLength={400}
        />
        <button className="btn btn--primary" type="submit" disabled={!text.trim()}>
          {t('chat.send')}
        </button>
      </form>
    </div>
  );
}
