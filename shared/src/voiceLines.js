/**
 * Table talk: everything the CPUs and the announcer can say out loud.
 *
 * Each CPU line is recorded in every CPU character voice; announcer lines in
 * the announcer voice. Audio files live at
 *   /assets/voice/<voiceKey>/<lineId>.mp3
 * The server decides who says what and when (so every seat hears the same
 * line); clients just play the file and show the text.
 */

/** CPU character voices (Kokoro TTS voice ids). */
export const CPU_VOICES = {
  oldtimer: { voice: 'am_santa', speed: 0.92, label: 'Old prospector' },
  gambler: { voice: 'am_michael', speed: 1.0, label: 'Card sharp' },
  gunslinger: { voice: 'am_fenrir', speed: 0.95, label: 'Gunslinger' },
  kid: { voice: 'am_puck', speed: 1.08, label: 'Young gun' },
  dandy: { voice: 'bm_george', speed: 1.0, label: 'Dandy' },
  belle: { voice: 'af_bella', speed: 1.0, label: 'Saloon belle' },
  sharp: { voice: 'af_sarah', speed: 1.04, label: 'Sharpshooter' }
};

/** Dealer callouts ("Check.", "All in.") use their own steady voice. */
export const DEALER_VOICE = { key: 'dealer', voice: 'bm_lewis', speed: 1.0 };

/** The announcer (Chatterbox TTS) celebrates big moments. */
export const ANNOUNCER_KEY = 'announcer';

/** Which character voice each named CPU uses. Unknown names hash into the cast. */
const VOICE_BY_NAME = {
  'Cactus Kate': 'sharp',
  Mabel: 'belle',
  'Ace Annie': 'sharp',
  Nina: 'belle',
  Tessa: 'sharp',
  'Vera Vain': 'belle',
  'Dusty Dave': 'oldtimer',
  'Lucky Lou': 'kid',
  'Salty Sam': 'oldtimer',
  Rico: 'gambler',
  'Pete Sharp': 'gambler',
  Oscar: 'dandy',
  Wade: 'gunslinger',
  'Blind Jack': 'oldtimer',
  'The Count': 'dandy',
  Ghost: 'gunslinger',
  Rook: 'kid',
  Silas: 'gunslinger'
};

export function voiceForName(name = '') {
  if (VOICE_BY_NAME[name]) return VOICE_BY_NAME[name];
  const keys = Object.keys(CPU_VOICES);
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return keys[h % keys.length];
}

/** Lines a CPU can say, by situation. Every line exists in every CPU voice. */
export const CPU_LINES = {
  greet: [
    'Howdy, partners. Deal me in.',
    "Evenin', folks. Who's buyin' the first round?",
    'Pull up a chair. My chips are lonely.',
    'Mind if I sit a spell and take your money?',
    'Well, look what the tumbleweed dragged in.',
    'I just came for the free peanuts. And your chips.'
  ],
  winSmall: [
    "I'll take that, thank you kindly.",
    'Easy as pie.',
    "Don't mind if I do.",
    'Another day, another dollar.',
    "Y'all folded faster than a cheap lawn chair.",
    'Thank you for your donation.',
    "Small pot, but it's mine.",
    'Nobody wanted it? More for me.'
  ],
  winBig: [
    "Read 'em and weep!",
    'Yee-haw! Pay the man!',
    "That's how we do it out west!",
    'Somebody fetch me a bigger hat for all these chips!',
    "I'm buyin' the whole saloon a round. With your money.",
    'Well slap my knee and call me lucky!',
    "Pleasure doin' business, partner.",
    "Momma always said I'd be good at somethin'."
  ],
  winBluff: [
    "Had nothin'. Absolutely nothin'.",
    'Bluffed ya clean out of your boots!',
    "You'll never know what I had. It was garbage.",
    'Fortune favors the bold. And the fibbers.',
    'Poker face, partner. Poker face.'
  ],
  badBeat: [
    "Well, I'll be a horse's uncle.",
    'Dang river. Never trusted water anyway.',
    'That stings worse than a scorpion in my boot.',
    'You lucky son of a gun!',
    'I want a recount!',
    "That's it, I'm blamin' the dealer.",
    "My horse could've played that better."
  ],
  heckleFold: [
    'Run along now, partner.',
    'Scared of a little bet, are ya?',
    "That's right, fold like your grandpa's laundry.",
    "Coward's way out. Smart, but cowardly.",
    'Bawk bawk! Chicken!',
    'Wise choice. I had the nuts. Probably.',
    'Thanks for the chips, sugar.',
    "Don't cry, there's always next hand."
  ],
  heckleSlow: [
    "Clock's tickin', partner!",
    'Sometime this century, maybe?',
    "I've seen glaciers move faster.",
    'Did you fall asleep on me?',
    "My beard's grown an inch waitin' on you.",
    "Take your time. I'll just age gracefully over here.",
    "The sun's settin', friend. Make a move."
  ],
  allInBot: [
    "I'm all in. Your move, cowboy.",
    "Let's dance. All of it.",
    'Every last chip. Call if you dare.',
    'Shove! Yee-haw!',
    "All in, partner. Feelin' lucky?",
    'No guts, no glory. All in.'
  ],
  reactAllIn: [
    'Whoa there, big spender!',
    "Somebody's feelin' brave tonight.",
    "All in? You must have a pair of somethin'.",
    "Easy, cowboy. That's a lot of chips.",
    "Now that's either genius or whiskey talkin'.",
    "Bold move. Let's see if it pays."
  ],
  niceHand: [
    'Nice hand. I hate it, but nice hand.',
    "Well played, partner. Don't let it go to your head.",
    "Beginner's luck, I reckon.",
    'You got me fair and square. This time.',
    'Hmph. Enjoy it while it lasts.',
    'I tip my hat to ya. Grudgingly.'
  ],
  busted: [
    "I'm plumb out. Good game, folks.",
    "Reckon I'll mosey on.",
    'Cleaned me out, fair and square.',
    "Back to pannin' for gold, I guess.",
    "Well, that's all she wrote."
  ],
  humanBusted: [
    'Another one bites the dust!',
    'Come back when you got more chips, partner.',
    "Don't worry, the stagecoach leaves at noon.",
    'You can always sell your horse.',
    'Better luck next time, greenhorn.'
  ]
};

/** Lines for the announcer, by situation. */
export const ANNOUNCER_LINES = {
  humanWin: [
    'Winner, winner, beans for dinner!',
    'Somebody fetch a wheelbarrow for those chips!',
    'The saloon salutes you, partner!',
    "Now that's how you rob a stagecoach!",
    'Yee-haw! Pay the winner!',
    'Well slap me silly, what a hand!'
  ],
  // Keyed by hand category (handEvaluator CATEGORIES): straight and up.
  handStraight: ["A straight! Straighter than a sheriff's aim!"],
  handFlush: ['A flush! Smoother than Sunday whiskey!'],
  handFullHouse: ["Full house! Pack 'em in, folks!"],
  handQuads: ['Four of a kind! Somebody check those sleeves!'],
  handStraightFlush: ['A straight flush! Ring the church bells!'],
  handRoyal: ['A royal flush! Fetch the governor!'],
  tournamentWin: [
    'Champion of the whole dang territory!',
    'Last one standing! Hang that picture over the bar!'
  ],
  blindsUp: ["Blinds are goin' up, folks! Hold onto your hats!", 'Ante up! The stakes just got higher!'],
  shuffle: ['Shuffle up and deal!'],
  endOfTrail: ['End of the trail, partner.'],
  // Station IDs for KSAL saloon radio, played between songs.
  radio: [
    "You're listening to K-S-A-L, saloon radio. Now back to the music.",
    'K-S-A-L, eighteen eighty-five on your dial. Keep them cards close, partners.',
    "This is saloon radio. If you're losin', it ain't the music's fault.",
    'K-S-A-L, brought to you by the general store. We sell shovels. Mostly to poker players.',
    "Saloon radio, playin' the hits since before there were hits.",
    'That last one goes out to everybody who just went all in. Bless your hearts.'
  ],
  // The DJ's jokes, also played between songs.
  radioJoke: [
    "Doc says I've got a gamblin' problem. I bet him ten dollars he's wrong.",
    "Why'd the poker player bring a ladder to the saloon? Heard the stakes were high.",
    "What do you call a cowboy who always folds? Laundry Larry.",
    "My uncle Jeb bluffed with a pair of twos for forty years. They buried him with 'em. Folks still think he had aces.",
    "Old Pete lost his horse in a card game. Now he walks everywhere. Says it's good for his heart. His wallet disagrees.",
    "How can you tell a cowboy's been playin' poker? His hat's still on, but his saddle's gone.",
    "The sheriff banned cards in the saloon, so we play poker with dominoes now. Still losin'.",
    "Never play cards with a man named Doc, never eat at a place called Mom's, and never call a river with a pair of threes."
  ]
};

/** Category name for a big showdown hand (handEvaluator category number), or null. */
export function handLineCategory(category) {
  return (
    {
      4: 'handStraight',
      5: 'handFlush',
      6: 'handFullHouse',
      7: 'handQuads',
      8: 'handStraightFlush',
      9: 'handRoyal'
    }[category] || null
  );
}

/** Dealer callouts, one per action. */
export const DEALER_LINES = {
  check: 'Check.',
  call: 'Call.',
  bet: 'Bet.',
  raise: 'Raise.',
  allin: 'All in!',
  fold: 'Fold.'
};

/** Stable id for line `index` of `category` (also its file name). */
export const lineId = (category, index) => `${category}-${index + 1}`;

/** Every line, flattened: [{ id, category, text, speaker: 'cpu' | 'announcer' | 'dealer' }]. */
export function allLines() {
  const out = [];
  for (const [category, lines] of Object.entries(CPU_LINES)) {
    lines.forEach((text, i) => out.push({ id: lineId(category, i), category, text, speaker: 'cpu' }));
  }
  for (const [category, lines] of Object.entries(ANNOUNCER_LINES)) {
    lines.forEach((text, i) => out.push({ id: lineId(category, i), category, text, speaker: 'announcer' }));
  }
  for (const [action, text] of Object.entries(DEALER_LINES)) {
    out.push({ id: `dealer-${action}`, category: 'dealer', text, speaker: 'dealer' });
  }
  return out;
}

/** Pick a line of `category` (avoiding `lastId` when possible) using `random` in [0,1). */
export function pickLine(table, category, random = Math.random, lastId = null) {
  const lines = table[category];
  if (!lines || !lines.length) return null;
  let index = Math.floor(random() * lines.length);
  if (lines.length > 1 && lineId(category, index) === lastId) index = (index + 1) % lines.length;
  return { id: lineId(category, index), category, text: lines[index] };
}
