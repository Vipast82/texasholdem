import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';

export default function ChatPanel() {
  const chat = useGameStore((s) => s.chat);
  const sendChat = useGameStore((s) => s.sendChat);
  const [text, setText] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    if (endRef.current && typeof endRef.current.scrollIntoView === 'function') {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chat]);

  const submit = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    sendChat(t);
    setText('');
  };

  return (
    <div className="chat">
      <h2 className="chat__title">{t('chat.title')}</h2>
      <div className="chat__log" role="log" aria-live="polite" aria-relevant="additions">
        {chat.length === 0 && <p className="chat__empty">{t('chat.empty')}</p>}
        {chat.map((m, i) => (
          <div key={i} className="chat__msg">
            <span className="chat__from">{m.from}</span>
            <span className="chat__text">{m.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="chat__form" onSubmit={submit}>
        <input
          aria-label={t('chat.placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('chat.placeholder')}
          maxLength={400}
        />
        <button className="btn btn--primary" type="submit">
          {t('chat.send')}
        </button>
      </form>
    </div>
  );
}
