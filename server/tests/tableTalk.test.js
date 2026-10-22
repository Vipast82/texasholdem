import { describe, it, expect } from 'vitest';
import {
  GameTable,
  CPU_LINES,
  ANNOUNCER_LINES,
  allLines,
  voiceForName,
  CPU_VOICES,
  pickLine
} from '@saloon/shared';
import { handEndTalk, actionTalk, slowHeckler } from '../src/tableTalk.js';

const always = () => 0; // dice that always say "yes"
const never = () => 0.999; // dice that always say "no"

function table(stacks = { you: 1500, cpu: 1500 }) {
  const t = new GameTable({ smallBlind: 10, bigBlind: 20, startingStack: 1500, tutorialSeed: 'talk' });
  Object.entries(stacks).forEach(([id, chips], seat) => {
    t.addPlayer({
      id,
      name: id === 'you' ? 'You' : 'Wade',
      seat,
      isBot: id !== 'you',
      bot: id !== 'you' ? { difficulty: 'hard' } : null
    });
    t.playerById(id).chips = chips;
  });
  return t;
}

describe('voice line catalog', () => {
  it('has a line for every category the director uses', () => {
    for (const c of [
      'greet',
      'winSmall',
      'winBig',
      'winBluff',
      'badBeat',
      'heckleFold',
      'heckleSlow',
      'allInBot',
      'reactAllIn',
      'niceHand',
      'busted',
      'humanBusted'
    ]) {
      expect(CPU_LINES[c].length).toBeGreaterThan(0);
    }
    for (const c of [
      'humanWin',
      'handStraight',
      'handFlush',
      'handFullHouse',
      'handQuads',
      'handStraightFlush',
      'handRoyal',
      'tournamentWin',
      'blindsUp',
      'shuffle',
      'endOfTrail'
    ]) {
      expect(ANNOUNCER_LINES[c].length).toBeGreaterThan(0);
    }
  });

  it('gives every line a unique id per speaker', () => {
    const ids = allLines().map((l) => `${l.speaker}:${l.id}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('casts every CPU name into a known voice, and avoids repeats', () => {
    for (const name of ['Wade', 'Vera Vain', 'Somebody New'])
      expect(CPU_VOICES[voiceForName(name)]).toBeTruthy();
    const first = pickLine(CPU_LINES, 'greet', () => 0);
    expect(pickLine(CPU_LINES, 'greet', () => 0, first.id).id).not.toBe(first.id);
  });
});

describe('table talk director', () => {
  it('a CPU heckles a human who folds to its bet', () => {
    const t = table();
    t.startHand();
    // Heads-up: the button (seat 1, the CPU) acts first.
    t.applyAction('cpu', 'raise', 100);
    t.applyAction('you', 'fold');
    const action = t.actionLog[t.actionLog.length - 1];
    expect(actionTalk(t, { ...action, street: 'preflop' }, always)).toMatchObject({
      playerId: 'cpu',
      category: 'heckleFold'
    });
    expect(actionTalk(t, { ...action, street: 'preflop' }, never)).toBeNull();
  });

  it('CPUs react to a human shove and announce their own', () => {
    const t = table();
    t.startHand();
    t.applyAction('cpu', 'call');
    t.applyAction('you', 'allin');
    expect(actionTalk(t, { playerId: 'you', action: 'allin', street: 'preflop' }, always)).toMatchObject({
      category: 'reactAllIn'
    });
    expect(actionTalk(t, { playerId: 'cpu', action: 'allin', street: 'preflop' }, always)).toMatchObject({
      category: 'allInBot'
    });
  });

  it('a busted CPU says goodbye, and a winning human hears the announcer', () => {
    const t = table({ you: 1500, cpu: 100 });
    t.startHand();
    while (t.inHand) {
      const id = t.nextActorId();
      t.applyAction(
        id,
        id === 'cpu' || t.currentBet > t.playerById(id).contributions[t.street]
          ? id === 'cpu'
            ? 'allin'
            : 'call'
          : 'check'
      );
    }
    const talk = handEndTalk(t, always);
    if (t.playerById('cpu').chips === 0) {
      expect(talk[0]).toMatchObject({ speaker: 'cpu', category: 'busted' });
    } else {
      expect(talk.some((d) => d.speaker === 'cpu')).toBe(true);
    }
  });

  it('stays quiet when the dice say so', () => {
    const t = table();
    t.startHand();
    t.applyAction('cpu', 'fold');
    expect(handEndTalk(t, never)).toEqual([]);
  });

  it('nags a slow player through another CPU', () => {
    const t = table({ you: 1500, cpu: 1500, cpu2: 1500 });
    t.startHand();
    expect(slowHeckler(t, 'you', always)).toMatchObject({ category: 'heckleSlow' });
  });
});
