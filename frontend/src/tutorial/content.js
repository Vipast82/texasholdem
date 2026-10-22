/**
 * Load all tutorial event content into a single eventKey -> entry map.
 * The engine stores these keys; the UI resolves the {..} placeholders and the
 * i18n keys via `t` at render time, so the engine itself stays locale-agnostic.
 */
import shuffle from './events/shuffle.json';
import deal from './events/deal.json';
import flop from './events/flop.json';
import turn from './events/turn.json';
import river from './events/river.json';
import bet from './events/bet.json';
import fold from './events/fold.json';
import showdown from './events/showdown.json';

export function loadTutorialContent() {
  const files = [shuffle, deal, flop, turn, river, bet, fold, showdown];
  const content = {};
  for (const entry of files) {
    if (entry && entry.eventKey) content[entry.eventKey] = entry;
  }
  return content;
}
