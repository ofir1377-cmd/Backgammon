'use strict';

const test = require('node:test');
const assert = require('node:assert');
const G = require('../src/game');
const { Room, GameError } = require('../src/room');

function emptyBoard() {
  return { points: new Array(24).fill(0), bar: { w: 0, b: 0 }, off: { w: 0, b: 0 } };
}

test('initial board has 15 checkers per side and 167 pips', () => {
  const b = G.initialBoard();
  const w = b.points.filter((v) => v > 0).reduce((a, v) => a + v, 0);
  const k = b.points.filter((v) => v < 0).reduce((a, v) => a - v, 0);
  assert.strictEqual(w, 15);
  assert.strictEqual(k, 15);
  assert.strictEqual(G.pipCount(b, 'w'), 167);
  assert.strictEqual(G.pipCount(b, 'b'), 167);
});

test('cannot land on a point held by two opponent checkers', () => {
  const b = G.initialBoard();
  // White from 12 (13-pt) with a 1 would land on 11, held by 5 black.
  const moves = G.movesForDie(b, 'w', 1);
  assert.ok(!moves.some((m) => m.from === 12 && m.to === 11));
});

test('hitting a blot sends it to the bar', () => {
  const b = emptyBoard();
  b.points[10] = 1;
  b.points[8] = -1;
  const after = G.applyMove(b, 'w', { from: 10, to: 8, die: 2 });
  assert.strictEqual(after.points[8], 1);
  assert.strictEqual(after.bar.b, 1);
});

test('checker on the bar must enter first', () => {
  const b = G.initialBoard();
  b.points[23] = 1;
  b.bar.w = 1;
  const legal = G.legalMoves(b, 'w', [3, 5]);
  assert.ok(legal.length > 0);
  assert.ok(legal.every((m) => m.from === 'bar'));
  // Entry point for white with a 3 is index 21, with a 5 is index 19.
  assert.deepStrictEqual(new Set(legal.map((m) => m.to)), new Set([21, 19]));
});

test('black enters on the opposite side', () => {
  const b = G.initialBoard();
  b.points[0] = -1;
  b.bar.b = 1;
  const legal = G.legalMoves(b, 'b', [6, 6, 6, 6]);
  // index 5 is white's 6-point with 5 checkers -> blocked
  assert.deepStrictEqual(legal, []);
});

test('must use both dice when possible', () => {
  const b = emptyBoard();
  // White checker on 10. Die 6 -> 4 blocked? keep open. Other checker on 2.
  b.points[10] = 1;
  b.points[3] = 1;
  b.points[1] = -2; // blocks 3->1 with a 2
  b.points[4] = -2; // blocks 10->4 with a 6
  // dice 6,2: 10-2=8 then 8-6=2 is possible, so the only legal first move uses the 10 checker
  const legal = G.legalMoves(b, 'w', [6, 2]);
  assert.deepStrictEqual(legal, [{ from: 10, to: 8, die: 2 }]);
});

test('if only one die can be played, the higher one must be played', () => {
  const b = emptyBoard();
  b.points[8] = 1;
  b.points[3] = -2; // blocks 8->3 (die 5)? no: 8-5=3 blocked
  b.points[2] = -2;
  // dice 6 and 5: 8-6=2 blocked, 8-5=3 blocked → nothing
  assert.deepStrictEqual(G.legalMoves(b, 'w', [6, 5]), []);

  const c = emptyBoard();
  c.points[13] = 1;
  c.points[4] = -2;
  c.points[3] = -2;
  // dice 4 and 6: 13-4=9 then 9-6=3 blocked; 13-6=7 then 7-4=3 blocked. Only one die playable.
  const legal = G.legalMoves(c, 'w', [4, 6]);
  assert.deepStrictEqual(legal, [{ from: 13, to: 7, die: 6 }]);
});

test('bearing off: exact, overshoot only from highest point', () => {
  const b = emptyBoard();
  b.points[4] = 1; // 5-point
  b.points[1] = 1; // 2-point
  b.off.w = 13;
  const sixes = G.movesForDie(b, 'w', 6);
  assert.deepStrictEqual(sixes.map((m) => [m.from, m.to]), [[4, 'off']]);
  const twos = G.movesForDie(b, 'w', 2);
  assert.ok(twos.some((m) => m.from === 1 && m.to === 'off'));
  assert.ok(twos.some((m) => m.from === 4 && m.to === 2));
});

test('cannot bear off with a checker outside home', () => {
  const b = emptyBoard();
  b.points[0] = 14;
  b.points[6] = 1;
  const moves = G.movesForDie(b, 'w', 1);
  assert.ok(!moves.some((m) => m.to === 'off'));
});

test('black bears off past index 23', () => {
  const b = emptyBoard();
  b.points[20] = -1;
  b.off.b = 14;
  const moves = G.movesForDie(b, 'b', 6);
  assert.deepStrictEqual(moves.map((m) => [m.from, m.to]), [[20, 'off']]);
});

test('win multiplier: single, gammon, backgammon', () => {
  const b = emptyBoard();
  b.off.w = 15;
  b.points[20] = -15;
  assert.strictEqual(G.winMultiplier(b, 'w'), 2);
  b.points[20] = -14;
  b.points[3] = -1;
  assert.strictEqual(G.winMultiplier(b, 'w'), 3);
  b.off.b = 1;
  assert.strictEqual(G.winMultiplier(b, 'w'), 1);
});

function scriptedRng(values) {
  // values are dice 1..6; converts to rng outputs
  let i = 0;
  return () => (values[i++ % values.length] - 1) / 6 + 0.01;
}

test('room flow: join, opening roll, move, undo, end turn', () => {
  const room = new Room('1234', scriptedRng([3, 1, 5, 2]));
  assert.strictEqual(room.join('a', 'Alice'), 'w');
  assert.strictEqual(room.phase, 'waiting');
  assert.strictEqual(room.join('b', 'Bob'), 'b');
  assert.strictEqual(room.phase, 'move');
  assert.strictEqual(room.turn, 'w'); // 3 vs 1
  assert.deepStrictEqual(room.remaining, [3, 1]);

  assert.throws(() => room.roll('b'), GameError);
  assert.throws(() => room.move('w', 23, 0), GameError);

  room.move('w', 7, 4); // 8/5
  room.move('w', 5, 4); // 6/5 – classic 31
  assert.strictEqual(room.board.points[4], 2);
  assert.strictEqual(room.viewFor('w').canEndTurn, true);
  room.undo('w');
  assert.strictEqual(room.board.points[4], 1);
  room.move('w', 5, 4);
  room.endTurn('w');
  assert.strictEqual(room.turn, 'b');
  assert.strictEqual(room.phase, 'roll');
  room.roll('b');
  assert.deepStrictEqual(room.dice, [5, 2]);
  assert.throws(() => room.join('c', 'Carol'), GameError);
  // rejoin with same token keeps seat
  assert.strictEqual(room.join('a', ''), 'w');
});

test('room: winning the game updates score and allows rematch', () => {
  const room = new Room('5555', scriptedRng([6, 1, 2, 2]));
  room.join('a', 'A');
  room.join('b', 'B');
  assert.strictEqual(room.turn, 'w');
  room.board = emptyBoard();
  room.board.points[0] = 1;
  room.board.off.w = 14;
  room.board.points[23] = -15;
  room.remaining = [6, 1];
  room.move('w', 0, 'off');
  assert.strictEqual(room.phase, 'gameover');
  assert.strictEqual(room.winner, 'w');
  assert.strictEqual(room.score.w, 2); // gammon
  room.requestRematch('w');
  assert.strictEqual(room.phase, 'gameover');
  room.requestRematch('b');
  assert.strictEqual(room.phase, 'move');
  assert.strictEqual(room.gameNumber, 2);
});

test('random self-play games always terminate with a valid winner', () => {
  for (let g = 0; g < 30; g++) {
    const room = new Room('9999');
    room.join('a', 'A');
    room.join('b', 'B');
    let steps = 0;
    while (room.phase !== 'gameover' && steps < 5000) {
      steps++;
      const c = room.turn;
      if (room.phase === 'roll') room.roll(c);
      const legal = room.legal();
      if (legal.length === 0) room.endTurn(c);
      else {
        const m = legal[Math.floor(Math.random() * legal.length)];
        room.move(c, m.from, m.to);
      }
      const b = room.board;
      for (const col of ['w', 'b']) {
        let total = b.bar[col] + b.off[col];
        for (const v of b.points) total += col === 'w' ? Math.max(v, 0) : Math.max(-v, 0);
        assert.strictEqual(total, 15);
      }
    }
    assert.strictEqual(room.phase, 'gameover');
  }
});
