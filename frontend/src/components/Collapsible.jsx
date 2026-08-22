import { useCallback, useState } from 'react';
import { t } from '../i18n.js';

/**
 * Collapsible (Sprint 7) — a reusable, accessible disclosure wrapper for the
 * side panels (Tutorial & Options, Hand Rankings, Hand History, Chat, and the
 * Tutorial log). Each instance is keyed by `id` so its open/closed state is
 * remembered per-tab across re-renders and page refreshes (sessionStorage).
 *
 * Accessibility (matches the Sprint 6 a11y bar):
 *   - the header is a real <button> (keyboard-activatable, focusable);
 *   - aria-expanded + aria-controls describe the disclosure state;
 *   - the content region is a labelled <section> with the matching id;
 *   - reduced-motion is already respected because we toggle visibility, not
 *     animate (no transition to disable).
 *
 * The component is purely presentational: it renders `title` as the header and
 * its children as the body. State lives in sessionStorage under `saloon.collapse.<id>`.
 */

const PREFIX = 'saloon.collapse.';

function readCollapsed(id) {
  try {
    const raw = sessionStorage.getItem(PREFIX + id);
    if (raw === null) return null; // never set -> let `defaultOpen` decide
    return raw === '1';
  } catch (err) {
    return null;
  }
}

function writeCollapsed(id, collapsed) {
  try {
    sessionStorage.setItem(PREFIX + id, collapsed ? '1' : '0');
  } catch (err) {
    // sessionStorage may be unavailable (private mode) — degrade gracefully.
  }
}

export default function Collapsible({ id, title, defaultOpen = true, showHeader = true, children }) {
  // `defaultOpen` is only the first-run fallback; afterwards the user's choice
  // (persisted in sessionStorage) always wins, so a refresh keeps the layout.
  const [collapsed, setCollapsed] = useState(() => (readCollapsed(id) !== null ? readCollapsed(id) : !defaultOpen));
  const bodyId = `collapse-body-${id}`;

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      writeCollapsed(id, next);
      return next;
    });
  }, [id]);

  const panelName = String(title || id);

  if (!showHeader) {
    // Headerless mode: the wrapped panel provides its own <h2>/heading. We still
    // render an accessible, keyboard-operable toggle (a button carrying the
    // aria-expanded / aria-controls disclosure state) right above the body.
    return (
      <div className={`collapsible collapsible--bare${collapsed ? ' collapsible--collapsed' : ''}`}>
        <button
          type="button"
          className="collapsible__bare-toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={collapsed ? t('a11y.panel.expand', { panel: panelName }) : t('a11y.panel.collapse', { panel: panelName })}
        >
          <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        </button>
        {!collapsed && (
          <section className="collapsible__body" id={bodyId} aria-hidden={false}>
            {children}
          </section>
        )}
      </div>
    );
  }

  return (
    <div className={`collapsible${collapsed ? ' collapsible--collapsed' : ''}`}>
      <button
        type="button"
        className="collapsible__header"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        aria-label={collapsed ? t('a11y.panel.expand', { panel: panelName }) : t('a11y.panel.collapse', { panel: panelName })}
      >
        <span className="collapsible__title" aria-hidden="true">
          {title}
        </span>
        <span className="collapsible__chevron" aria-hidden="true">
          {collapsed ? '▸' : '▾'}
        </span>
      </button>
      {!collapsed && (
        <section className="collapsible__body" id={bodyId} aria-hidden={false}>
          {children}
        </section>
      )}
    </div>
  );
}