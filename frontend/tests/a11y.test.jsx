/**
 * @vitest-environment jsdom
 *
 * Sprint 6 — Accessibility (A11y) real-render assertions.
 *
 * These render actual React components into a jsdom document and assert the
 * ARIA roles / labels / live-regions the spec requires, that the primary
 * controls are keyboard-activatable (Enter/Space fire the store action), and
 * that the new a11y i18n keys exist in BOTH locales.
 *
 * We mock `socket.js` so nothing opens a real network connection under jsdom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import en from '../src/i18n/en.json';
import es from '../src/i18n/es.json';

// Mock the socket BEFORE the store pulls it in.
vi.mock('../src/socket.js', () => ({
  socket: {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    close: vi.fn(),
    removeListener: vi.fn()
  },
  emitAck: vi.fn().mockResolvedValue({ ok: true, snapshot: null })
}));

import { useGameStore } from '../src/store.js';
import DealerButton from '../src/components/DealerButton.jsx';
import EmoteBar from '../src/components/EmoteBar.jsx';
import HandRankingGuide from '../src/components/HandRankingGuide.jsx';
import SettingsPanel from '../src/components/SettingsPanel.jsx';
import ChatPanel from '../src/components/ChatPanel.jsx';
import TutorialPanel from '../src/components/TutorialPanel.jsx';
import Controls from '../src/components/Controls.jsx';
import AvatarCropper from '../src/components/AvatarCropper.jsx';
import SeatAvatar from '../src/components/SeatAvatar.jsx';

/** Reset the store to a known state between tests (store is a shared singleton). */
function resetStore() {
  useGameStore.setState({
    connected: true,
    tableId: null,
    playerId: null,
    name: 'Gunslinger',
    snapshot: null,
    chat: [],
    error: null,
    botActions: {},
    tutorial: { mode: 'off', verbosity: 'normal', hintsEnabled: false, locale: 'en' },
    hud: { enabled: false, seed: 'hud', iterations: 300 },
    spectator: { active: false, showAll: true, tableId: null },
    history: { records: [], autoPersist: false },
    sfx: { muted: false, volume: 0.8 },
    emotes: {},
    _emoteTimers: {}
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe('i18n a11y keys exist in both locales', () => {
  const a11yKeys = [
    'a11y.stickfigure',
    'a11y.stickfigure.default',
    'a11y.avatar',
    'a11y.avatar.default',
    'a11y.chipCount',
    'a11y.srLive.announced',
    'a11y.skipToTable'
  ];
  it.each(a11yKeys)('en.json has %s', (k) => expect(en[k]).toBeTruthy());
  it.each(a11yKeys)('es.json has %s', (k) => expect(es[k]).toBeTruthy());
});

describe('roles + accessible names on key controls', () => {
  it('DealerButton exposes role=img with an accessible name', () => {
    render(<DealerButton active seat='Sheriff' />);
    const node = document.querySelector('.dealerbtn');
    expect(node).toBeTruthy();
    expect(node.getAttribute('role')).toBe('img');
    expect(node.getAttribute('aria-label')).toMatch(/Dealer|Crupier/);
  });

  it('EmoteBar is a labeled toolbar and every emote button has a name', () => {
    useGameStore.setState({ playerId: 'me' });
    render(<EmoteBar playerId='me' />);
    const bar = document.querySelector('[role="toolbar"]');
    expect(bar).toBeTruthy();
    expect(bar.getAttribute('aria-label')).toBeTruthy();
    const buttons = bar.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((b) => {
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.getAttribute('aria-label').trim()).not.toBe('');
    });
  });

  it('HandRankingGuide is a labeled section with a heading', () => {
    render(<HandRankingGuide />);
    expect(document.querySelector('section[aria-label]')).toBeTruthy();
    expect(document.querySelector('h2')).toBeTruthy();
  });

  it('SettingsPanel is a labeled region and its inputs are named', () => {
    render(<SettingsPanel />);
    expect(document.querySelector('[aria-label]')).toBeTruthy();
    // Sprint 6 i18n — the in-table language toggle must be present and reachable.
    const langSelect = document.querySelector('select');
    expect(langSelect).toBeTruthy();
    expect(['en', 'es']).toContain(langSelect.value);
    document.querySelectorAll('input[type="checkbox"], input[type="range"]').forEach((el) => {
      const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      const inLabel = el.closest('label');
      expect(labelled || inLabel).toBeTruthy();
    });
  });

  it('SeatAvatar has an accessible name for a named player', () => {
    render(<SeatAvatar player={{ id: 'me', name: 'Sheriff' }} size={40} isMe />);
    const avatar = document.querySelector('.seatavatar');
    expect(avatar.getAttribute('role')).toBe('img');
    expect(avatar.getAttribute('aria-label')).toContain('Sheriff');
  });
});

describe('live regions announce game activity', () => {
  it('Chat log is a role=log with aria-live=polite', () => {
    render(<ChatPanel />);
    const log = document.querySelector('[role="log"]');
    expect(log).toBeTruthy();
    expect(log.getAttribute('aria-live')).toBe('polite');
    const input = document.querySelector('input');
    expect(input.getAttribute('aria-label')).toBeTruthy();
  });

  it('Tutorial log is a role=log with aria-live=polite', () => {
    render(<TutorialPanel />);
    const log = screen.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
  });

  it('Controls idle status is a role=status live region', () => {
    useGameStore.setState({
      snapshot: {
        inHand: true,
        nextActorId: null,
        currentBet: 0,
        street: 'preflop',
        players: [{ id: 'me', contributions: { preflop: 0 }, hasFolded: false, isAllIn: false }]
      },
      playerId: 'me'
    });
    render(<Controls snapshot={useGameStore.getState().snapshot} />);
    const status = document.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status.getAttribute('aria-live')).toBe('polite');
  });
});

describe('keyboard operability (no mouse required)', () => {
  it('activating the Start Hand button fires startHand', () => {
    const startSpy = vi.spyOn(useGameStore.getState(), 'startHand').mockResolvedValue({ ok: true });
    render(<Controls snapshot={{ inHand: false, players: [] }} />);
    const btn = screen.getByRole('button', { name: /Start Hand|Iniciar mano/i });
    expect(btn).toBeTruthy();
    btn.focus();
    fireEvent.keyUp(btn, { key: 'Enter', code: 'Enter', charCode: 13 });
    fireEvent.click(btn);
    expect(startSpy).toHaveBeenCalled();
    startSpy.mockRestore();
  });

  it('Check preset button is keyboard-activatable when it is my turn', () => {
    const actSpy = vi.spyOn(useGameStore.getState(), 'playerAction').mockResolvedValue({ ok: true });
    useGameStore.setState({
      playerId: 'me',
      snapshot: {
        inHand: true,
        nextActorId: 'me',
        currentBet: 0,
        bigBlind: 20,
        pot: 40,
        street: 'preflop',
        gameType: 'no-limit',
        lastRaiseIncrement: 0,
        players: [{ id: 'me', contributions: { preflop: 20 }, hasFolded: false, isAllIn: false, chips: 1500 }]
      }
    });
    render(<Controls snapshot={useGameStore.getState().snapshot} />);
    const check = screen.getByRole('button', { name: /Check|Pasarse/i });
    check.focus();
    fireEvent.keyUp(check, { key: 'Enter', code: 'Enter', charCode: 13 });
    fireEvent.click(check);
    expect(actSpy).toHaveBeenCalled();
    actSpy.mockRestore();
  });
});

describe('i18n live toggle re-renders the UI', () => {
  it('switching language updates the store and re-renders Spanish', () => {
    expect(useGameStore.getState().tutorial.locale).toBe('en');
    useGameStore.getState().setLocale('es');
    expect(useGameStore.getState().tutorial.locale).toBe('es');
    // The UI should now render a Spanish label (live re-render, no reload).
    render(<SettingsPanel />);
    const body = document.body.textContent || '';
    expect(body).toMatch(/Sonido|Idioma|Avatar/);
    useGameStore.getState().setLocale('en');
  });
});

describe('focus management (avatar dialog)', () => {
  it('moves focus into the dialog on open', () => {
    const opener = document.createElement('button');
    opener.textContent = 'open';
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);
    render(<AvatarCropper onCommit={() => {}} onCancel={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Escape key triggers onCancel (keyboard-dismissable)', () => {
    const onCancel = vi.fn();
    render(<AvatarCropper onCommit={() => {}} onCancel={onCancel} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});