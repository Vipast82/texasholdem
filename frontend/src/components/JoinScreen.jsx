import { useEffect, useState } from 'react';
import { useGameStore } from '../store.js';
import { emitAck } from '../socket.js';
import { t } from '../i18n.js';
import AvatarCreator from './AvatarCreator.jsx';
import { avatarPreviewSrc } from '../services/characterArt.js';

const GAMES = ['cash', 'tournament', 'friends', 'watch'];
const BLINDS = [
  [5, 10],
  [10, 20],
  [25, 50],
  [50, 100]
];
const STACKS = [50, 100, 200]; // in big blinds
const CLOCKS = [0, 15, 30, 60];

/** Defaults per game type: what a quick start should look like. */
const GAME_DEFAULTS = {
  cash: { cpuCount: 4, stackBB: 100, clock: 30 },
  tournament: { cpuCount: 5, stackBB: 50, clock: 30 },
  friends: { cpuCount: 0, stackBB: 100, clock: 30 }
};

const randomTableName = () => `saloon-${Math.random().toString(36).slice(2, 6)}`;

/** Tables already running on this server (for joining friends). */
function OpenTables({ onPick }) {
  const [tables, setTables] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      emitAck('listTables').then((list) => {
        if (alive) setTables(Array.isArray(list) ? list : []);
      });
    load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  if (!tables) return null;
  if (!tables.length) return <p className="note">{t('join.noTables')}</p>;
  return (
    <ul className="opentables">
      {tables.map((tb) => (
        <li key={tb.tableId}>
          <button type="button" className="opentable" onClick={() => onPick(tb.tableId)}>
            <span className="opentable__name">{tb.tableId}</span>
            <span className="opentable__meta">
              {t(tb.mode === 'tournament' ? 'join.game.tournament' : 'join.game.cash')} ·{' '}
              {t('app.blinds', { sb: tb.smallBlind, bb: tb.bigBlind })} · {t('hud.players', { n: tb.seats })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Choice({ label, value, options, onChange, format }) {
  return (
    <div className="choice" role="radiogroup" aria-label={label}>
      <span className="choice__label">{label}</span>
      <div className="choice__opts">
        {options.map((o) => (
          <button
            key={String(o)}
            type="button"
            role="radio"
            aria-checked={value === o}
            className={`choice__opt${value === o ? ' choice__opt--on' : ''}`}
            onClick={() => onChange(o)}
          >
            {format ? format(o) : String(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function JoinScreen() {
  const join = useGameStore((s) => s.join);
  const clearError = useGameStore((s) => s.clearError);
  const enterSpectator = useGameStore((s) => s.enterSpectator);
  const saveProfile = useGameStore((s) => s.saveProfile);
  const locale = useGameStore((s) => s.tutorial.locale);
  const setLocale = useGameStore((s) => s.setLocale);
  const profile = useGameStore((s) => s.profile);
  const avatar = useGameStore((s) => s.avatar);
  const avatarMetaForJoin = useGameStore((s) => s.avatarMetaForJoin);

  const [name, setName] = useState(null); // null = use the saved name
  const [game, setGame] = useState('cash');
  const [friendsTable, setFriendsTable] = useState('main');
  const [cpuCount, setCpuCount] = useState(GAME_DEFAULTS.cash.cpuCount);
  const [difficulty, setDifficulty] = useState('mixed');
  const [blinds, setBlinds] = useState(1);
  const [stackBB, setStackBB] = useState(100);
  const [clock, setClock] = useState(30);
  const [speed, setSpeed] = useState('normal');
  const [showOptions, setShowOptions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const shownName = name ?? profile.name ?? 'Gunslinger';

  const pickGame = (g) => {
    setGame(g);
    const d = GAME_DEFAULTS[g];
    if (d) {
      setCpuCount(d.cpuCount);
      setStackBB(d.stackBB);
      setClock(d.clock);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    clearError();
    setBusy(true);
    try {
      if (game === 'watch') {
        await enterSpectator(friendsTable.trim() || 'main', true);
        return;
      }
      const label = shownName.trim() || 'Player';
      saveProfile({ name: label });
      const [sb, bb] = BLINDS[blinds];
      const tableId = game === 'friends' ? friendsTable.trim() || 'main' : randomTableName();
      const options = {
        mode: game === 'tournament' ? 'tournament' : 'cash',
        smallBlind: sb,
        bigBlind: bb,
        startingStack: bb * stackBB,
        turnSeconds: clock,
        autoDeal: true,
        cpuRebuy: game !== 'tournament',
        levelHands: 8,
        speed,
        cpuCount
      };
      await join(tableId, label, { botDifficulty: difficulty, avatarMeta: avatarMetaForJoin(), options });
    } finally {
      setBusy(false);
    }
  };

  const [sb, bb] = BLINDS[blinds];
  const summary = t('join.summary', {
    cpus: cpuCount,
    difficulty: t(`difficulty.${difficulty}`),
    sb,
    bb,
    stack: (bb * stackBB).toLocaleString(),
    clock: clock ? t('join.clockSeconds', { n: clock }) : t('join.clockOff')
  });

  return (
    <form className="join" onSubmit={submit}>
      <header className="join__head">
        <h1 className="join__title">{t('app.title')}</h1>
        <p className="join__subtitle">{t('join.subtitle')}</p>
      </header>

      <div className="join__who">
        <button
          type="button"
          className="join__avatar"
          onClick={() => setCreating(true)}
          aria-label={t('creator.open')}
        >
          <span
            className="join__avatarimg"
            style={{ backgroundImage: `url("${avatar.url || avatarPreviewSrc(shownName, profile.look)}")` }}
            aria-hidden="true"
          />
          <span className="join__avataredit">{t('creator.edit')}</span>
        </button>
        <label className="field">
          <span>{t('join.name')}</span>
          <input
            value={shownName}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('join.namePlaceholder')}
            maxLength={24}
            required
          />
        </label>
      </div>
      {creating && <AvatarCreator name={shownName} onClose={() => setCreating(false)} />}

      <fieldset className="join__modes">
        <legend>{t('join.howToPlay')}</legend>
        {GAMES.map((g) => (
          <label key={g} className={`mode${game === g ? ' mode--on' : ''}`}>
            <input type="radio" name="game" value={g} checked={game === g} onChange={() => pickGame(g)} />
            <span className="mode__title">{t(`join.game.${g}`)}</span>
            <span className="mode__help">{t(`join.game.${g}.help`)}</span>
          </label>
        ))}
      </fieldset>

      {(game === 'friends' || game === 'watch') && (
        <div className="join__friends">
          <label className="field">
            <span>{t('join.table')}</span>
            <input
              value={friendsTable}
              onChange={(e) => setFriendsTable(e.target.value)}
              placeholder="main"
              maxLength={64}
              required
            />
          </label>
          <span className="choice__label">{t('join.openTables')}</span>
          <OpenTables onPick={setFriendsTable} />
        </div>
      )}

      {game !== 'watch' && (
        <div className="join__options">
          <button
            type="button"
            className="join__optionstoggle"
            aria-expanded={showOptions}
            onClick={() => setShowOptions((v) => !v)}
          >
            <span>{t('join.tableOptions')}</span>
            <span className="join__summary">{summary}</span>
          </button>
          {showOptions && (
            <div className="join__optionsbody">
              <Choice
                label={t('join.cpuCount')}
                value={cpuCount}
                options={game === 'friends' ? [0, 1, 2, 3] : [1, 2, 3, 4, 5, 6, 7, 8]}
                onChange={setCpuCount}
              />
              <Choice
                label={t('join.botDifficulty')}
                value={difficulty}
                options={['easy', 'normal', 'hard', 'mixed']}
                onChange={setDifficulty}
                format={(d) => t(`difficulty.${d}`)}
              />
              <Choice
                label={t('join.blinds')}
                value={blinds}
                options={BLINDS.map((_, i) => i)}
                onChange={setBlinds}
                format={(i) => `${BLINDS[i][0]}/${BLINDS[i][1]}`}
              />
              <Choice
                label={t('join.stack')}
                value={stackBB}
                options={STACKS}
                onChange={setStackBB}
                format={(n) => t('join.bigBlinds', { n })}
              />
              <Choice
                label={t('join.clock')}
                value={clock}
                options={CLOCKS}
                onChange={setClock}
                format={(n) => (n ? t('join.clockSeconds', { n }) : t('join.clockOff'))}
              />
              <Choice
                label={t('join.speed')}
                value={speed}
                options={['normal', 'fast']}
                onChange={setSpeed}
                format={(v) => t(`join.speed.${v}`)}
              />
              {game === 'friends' && <p className="note">{t('join.friendsOptionsNote')}</p>}
            </div>
          )}
        </div>
      )}

      <button className="btn btn--primary btn--lg join__go" type="submit" disabled={busy}>
        {t(`join.go.${game}`)}
      </button>

      <footer className="join__foot">
        <p className="note">{t(`join.hint.${game}`)}</p>
        <label className="join__lang">
          <span>{t('settings.language')}</span>
          <select value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
      </footer>
    </form>
  );
}
