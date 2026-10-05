'use strict';

const G = require('./game');

class GameError extends Error {}

// One game room: two seats, a board, and match score. Knows nothing about sockets.
class Room {
  constructor(code, rng = Math.random) {
    this.code = code;
    this.rng = rng;
    this.players = { w: null, b: null }; // { token, name, connected }
    this.score = { w: 0, b: 0 };
    this.gameNumber = 0;
    this.touch();
    this.resetGame();
    this.phase = 'waiting';
  }

  touch() {
    this.lastActivity = Date.now();
  }

  resetGame() {
    this.board = G.initialBoard();
    this.turn = null;
    this.dice = [];
    this.remaining = [];
    this.history = [];
    this.lastTurnMoves = [];
    this.currentMoves = [];
    this.winner = null;
    this.multiplier = 0;
    this.message = '';
    this.rematchVotes = { w: false, b: false };
  }

  seatOf(token) {
    if (this.players.w && this.players.w.token === token) return G.WHITE;
    if (this.players.b && this.players.b.token === token) return G.BLACK;
    return null;
  }

  isFull() {
    return !!(this.players.w && this.players.b);
  }

  join(token, name) {
    const existing = this.seatOf(token);
    if (existing) {
      this.players[existing].connected = true;
      if (name) this.players[existing].name = name;
      this.touch();
      return existing;
    }
    const seat = !this.players.w ? G.WHITE : !this.players.b ? G.BLACK : null;
    if (!seat) throw new GameError('המשחק מלא – כבר יש בו שני שחקנים');
    this.players[seat] = { token, name: name || (seat === G.WHITE ? 'לבן' : 'שחור'), connected: true };
    this.touch();
    if (this.isFull() && this.phase === 'waiting') this.startGame();
    return seat;
  }

  setConnected(token, connected) {
    const seat = this.seatOf(token);
    if (seat) this.players[seat].connected = connected;
  }

  startGame() {
    this.resetGame();
    this.gameNumber += 1;
    // Opening roll: each player rolls one die, higher starts and plays both.
    let a, b;
    do {
      a = G.rollDie(this.rng);
      b = G.rollDie(this.rng);
    } while (a === b);
    this.turn = a > b ? G.WHITE : G.BLACK;
    this.dice = [a, b];
    this.remaining = [a, b];
    this.phase = 'move';
    this.message = `הטלת פתיחה: ${this.name(G.WHITE)} ${a}, ${this.name(G.BLACK)} ${b} – ${this.name(this.turn)} מתחיל`;
  }

  name(color) {
    return this.players[color] ? this.players[color].name : '';
  }

  requireTurn(color, phase) {
    if (this.phase !== phase || this.turn !== color) throw new GameError('זה לא התור שלך');
  }

  roll(color) {
    this.requireTurn(color, 'roll');
    const d1 = G.rollDie(this.rng);
    const d2 = G.rollDie(this.rng);
    this.dice = [d1, d2];
    this.remaining = G.diceToMoves(d1, d2);
    this.phase = 'move';
    this.message = '';
    this.touch();
  }

  legal() {
    if (this.phase !== 'move') return [];
    return G.legalMoves(this.board, this.turn, this.remaining);
  }

  move(color, from, to) {
    this.requireTurn(color, 'move');
    const options = this.legal().filter((m) => m.from === from && m.to === to);
    if (options.length === 0) throw new GameError('מהלך לא חוקי');
    const m = options.reduce((a, b) => (b.die < a.die ? b : a));

    this.history.push({ board: this.board, remaining: this.remaining, currentMoves: this.currentMoves });
    const hit = m.to !== 'off' && this.board.points[m.to] !== 0 && Math.sign(this.board.points[m.to]) !== (color === G.WHITE ? 1 : -1);
    this.board = G.applyMove(this.board, color, m);
    const rest = this.remaining.slice();
    rest.splice(rest.indexOf(m.die), 1);
    this.remaining = rest;
    this.currentMoves = [...this.currentMoves, { from: m.from, to: m.to, hit }];
    this.touch();

    if (this.board.off[color] === G.CHECKERS) {
      this.winner = color;
      this.multiplier = G.winMultiplier(this.board, color);
      this.score[color] += this.multiplier;
      this.phase = 'gameover';
      this.lastTurnMoves = this.currentMoves;
      this.history = [];
      const kind = { 1: 'ניצחון', 2: 'מארס (גמון) – 2 נקודות', 3: 'טורקי מארס (בקגמון) – 3 נקודות' }[this.multiplier];
      this.message = `${this.name(color)} ניצח! ${kind}`;
    }
  }

  undo(color) {
    this.requireTurn(color, 'move');
    const prev = this.history.pop();
    if (!prev) throw new GameError('אין מה לבטל');
    this.board = prev.board;
    this.remaining = prev.remaining;
    this.currentMoves = prev.currentMoves;
    this.touch();
  }

  endTurn(color) {
    this.requireTurn(color, 'move');
    if (this.legal().length > 0) throw new GameError('עדיין יש מהלכים לשחק');
    this.lastTurnMoves = this.currentMoves;
    this.currentMoves = [];
    this.history = [];
    this.turn = G.opponent(color);
    this.dice = [];
    this.remaining = [];
    this.phase = 'roll';
    this.message = '';
    this.touch();
  }

  requestRematch(color) {
    if (this.phase !== 'gameover') throw new GameError('המשחק עדיין לא נגמר');
    this.rematchVotes[color] = true;
    if (this.rematchVotes.w && this.rematchVotes.b) this.startGame();
    this.touch();
  }

  viewFor(color) {
    const legal = this.turn === color ? this.legal() : [];
    return {
      code: this.code,
      you: color,
      players: {
        w: this.players.w && { name: this.players.w.name, connected: this.players.w.connected },
        b: this.players.b && { name: this.players.b.name, connected: this.players.b.connected },
      },
      phase: this.phase,
      turn: this.turn,
      board: this.board,
      dice: this.dice,
      remaining: this.remaining,
      legal: legal.map(({ from, to }) => ({ from, to })),
      canUndo: this.turn === color && this.history.length > 0,
      canEndTurn: this.phase === 'move' && this.turn === color && legal.length === 0,
      lastTurnMoves: this.lastTurnMoves,
      currentMoves: this.currentMoves,
      pips: { w: G.pipCount(this.board, G.WHITE), b: G.pipCount(this.board, G.BLACK) },
      score: this.score,
      winner: this.winner,
      multiplier: this.multiplier,
      rematchVotes: this.rematchVotes,
      gameNumber: this.gameNumber,
      message: this.message,
    };
  }
}

module.exports = { Room, GameError };
