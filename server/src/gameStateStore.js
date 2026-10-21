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

  getOrCreate(tableId, config = {}) {
    if (this.tables.has(tableId)) return this.tables.get(tableId);
    const table = new GameTable({
      tableId,
      smallBlind: config.smallBlind || this.defaults.smallBlind || 10,
      bigBlind: config.bigBlind || this.defaults.bigBlind || 20,
      startingStack: config.startingStack || this.defaults.startingStack || 1500,
      gameType: config.gameType || this.defaults.gameType || 'no-limit',
      tutorialSeed: config.tutorialSeed
    });
    this.tables.set(tableId, { table, players: new Map() });
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
