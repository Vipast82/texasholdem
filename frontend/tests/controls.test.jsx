/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';

vi.mock('../src/socket.js', () => ({
  socket: { connected: true, on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  emitAck: vi.fn().mockResolvedValue({ ok: true })
}));

import { useGameStore } from '../src/store.js';
import Controls from '../src/components/Controls.jsx';

afterEach(cleanup);

/** A preflop snapshot where the big blind is out and `next` is to act. */
function snap(next, { myBet = 0 } = {}) {
  return {
    tableId: 't',
    handNumber: 3,
    inHand: true,
    street: 'preflop',
    currentBet: 20,
    bigBlind: 20,
    smallBlind: 10,
    pot: 30,
    gameType: 'no-limit',
    lastRaiseIncrement: 0,
    raiseCount: 0,
    nextActorId: next,
    players: [
      {
        id: 'me',
        status: 'in-hand',
        chips: 1000,
        hasFolded: false,
        isAllIn: false,
        contributions: { preflop: myBet }
      },
      {
        id: 'cpu',
        status: 'in-hand',
        chips: 1000,
        hasFolded: false,
        isAllIn: false,
        contributions: { preflop: 20 }
      }
    ]
  };
}

describe('Controls', () => {
  it('fires a queued "call any" as soon as it is my turn', () => {
    const spy = vi.fn().mockResolvedValue({ ok: true });
    useGameStore.setState({ playerId: 'me', playerAction: spy, preAction: null, snapshot: snap('cpu') });
    const { rerender } = render(<Controls snapshot={useGameStore.getState().snapshot} />);
    act(() => useGameStore.getState().setPreAction('callany'));
    expect(spy).not.toHaveBeenCalled();
    const mine = snap('me');
    act(() => useGameStore.setState({ snapshot: mine }));
    rerender(<Controls snapshot={mine} />);
    expect(spy).toHaveBeenCalledWith('call');
    expect(useGameStore.getState().preAction).toBeNull();
  });

  it('check/fold folds when facing a bet', () => {
    const spy = vi.fn().mockResolvedValue({ ok: true });
    useGameStore.setState({ playerId: 'me', playerAction: spy, preAction: null, snapshot: snap('cpu') });
    const { rerender } = render(<Controls snapshot={useGameStore.getState().snapshot} />);
    act(() => useGameStore.getState().setPreAction('checkfold'));
    rerender(<Controls snapshot={snap('me')} />);
    expect(spy).toHaveBeenCalledWith('fold');
  });

  it('keyboard shortcuts act on my turn', () => {
    const spy = vi.fn().mockResolvedValue({ ok: true });
    useGameStore.setState({ playerId: 'me', playerAction: spy, preAction: null, snapshot: snap('me') });
    render(<Controls snapshot={useGameStore.getState().snapshot} />);
    fireEvent.keyDown(window, { key: 'c' });
    expect(spy).toHaveBeenLastCalledWith('call');
    fireEvent.keyDown(window, { key: 'f' });
    expect(spy).toHaveBeenLastCalledWith('fold');
  });
});

describe('hand-end sound for me', () => {
  const ended = (payouts, { shown = {}, mine = 0 } = {}) => ({
    payouts,
    snapshot: {
      bigBlind: 20,
      lastShowdown: Object.keys(shown).length ? { all: shown } : null,
      players: [{ id: 'me', contributions: { preflop: mine, flop: 0, turn: 0, river: 0 } }]
    }
  });

  it('picks a small or big win flourish by pot size', async () => {
    const { handEndSoundForMe } = await import('../src/store.js');
    expect(handEndSoundForMe(ended({ me: 100 }), 'me')).toBe('cheer');
    expect(handEndSoundForMe(ended({ me: 2000 }), 'me')).toBe('bigWin');
  });

  it('only groans for a lost showdown, and saves the trombone for big ones', async () => {
    const { handEndSoundForMe } = await import('../src/store.js');
    expect(handEndSoundForMe(ended({ cpu: 100 }), 'me')).toBeNull(); // folded: silence
    expect(handEndSoundForMe(ended({ cpu: 100 }, { shown: { me: {}, cpu: {} }, mine: 40 }), 'me')).toBe(
      'grunt'
    );
    expect(handEndSoundForMe(ended({ cpu: 2000 }, { shown: { me: {}, cpu: {} }, mine: 1000 }), 'me')).toBe(
      'badBeat'
    );
  });
});
