import { GameTable } from '@saloon/shared';

/**
 * GameStateStore - keeps one authoritative GameTable per table id, plus the
 * player roster for each table (playerId -> {name, socketId}).
 */
export class GameStateStore {
  constructor(defaults = {}) {
    this.tables = new Map(); // tableId -> { table: GameTable, players: Map<playerId, meta> }
    this.defaults = defaults;
  }

  /**
   * The table for `tableId`, created with `settings` (already sanitized) if it
   * does not exist yet. Settings only apply when the table is created.
   */
  getOrCreate(tableId, settings = null) {
    if (this.tables.has(tableId)) return this.tables.get(tableId);
    const s = settings || this.defaults;
    const table = new GameTable({
      tableId,
      smallBlind: s.smallBlind || 10,
      bigBlind: s.bigBlind || 20,
      startingStack: s.startingStack || 1500,
      gameType: s.gameType || 'no-limit',
      tutorialSeed: s.tutorialSeed
    });
    this.tables.set(tableId, {
      table,
      players: new Map(), // playerId -> { name, socketId, timeouts, buyIns }
      settings: s,
      reads: {}, // opponent model for the CPUs
      session: {}, // playerId -> { handsWon, biggestPot }
      tour: null, // tournament state (see server)
      turn: null, // pending shot clock
      dealTimer: null,
      nextHandAt: null
    });
    return this.tables.get(tableId);
  }

  get(tableId) {
    return this.tables.get(tableId) || null;
  }

  delete(tableId) {
    return this.tables.delete(tableId);
  }

  listTables() {
    const out = [];
    for (const [id, entry] of this.tables.entries()) {
      out.push({
        tableId: id,
        gameType: entry.table.gameType,
        smallBlind: entry.table.smallBlind,
        bigBlind: entry.table.bigBlind,
        seats: entry.table.players.length,
        inHand: entry.table.inHand,
        handNumber: entry.table.handNumber,
        playerNames: entry.table.players.map((p) => p.name)
      });
    }
    return out;
  }
}
