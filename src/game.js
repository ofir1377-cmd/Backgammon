'use strict';

// Backgammon rules engine.
// Board: points[0..23]. Positive = white checkers, negative = black checkers.
// White moves from high to low (23 -> 0) and bears off below 0; home = 0..5.
// Black moves from low to high (0 -> 23) and bears off above 23; home = 18..23.

const WHITE = 'w';
const BLACK = 'b';
const CHECKERS = 15;

function opponent(color) {
  return color === WHITE ? BLACK : WHITE;
}

function initialBoard() {
  const points = new Array(24).fill(0);
  points[23] = 2;
  points[12] = 5;
  points[7] = 3;
  points[5] = 5;
  points[0] = -2;
  points[11] = -5;
  points[16] = -3;
  points[18] = -5;
  return { points, bar: { w: 0, b: 0 }, off: { w: 0, b: 0 } };
}

function cloneBoard(board) {
  return {
    points: board.points.slice(),
    bar: { ...board.bar },
    off: { ...board.off },
  };
}

function countAt(board, idx, color) {
  const v = board.points[idx];
  return color === WHITE ? Math.max(v, 0) : Math.max(-v, 0);
}

function allHome(board, color) {
  if (board.bar[color] > 0) return false;
  for (let i = 0; i < 24; i++) {
    const inHome = color === WHITE ? i <= 5 : i >= 18;
    if (!inHome && countAt(board, i, color) > 0) return false;
  }
  return true;
}

function isOpenFor(board, idx, color) {
  return countAt(board, idx, opponent(color)) < 2;
}

// Single moves available for one die value.
function movesForDie(board, color, die) {
  const moves = [];
  const dir = color === WHITE ? -1 : 1;

  if (board.bar[color] > 0) {
    const to = color === WHITE ? 24 - die : die - 1;
    if (isOpenFor(board, to, color)) moves.push({ from: 'bar', to, die });
    return moves;
  }

  const canBearOff = allHome(board, color);
  for (let from = 0; from < 24; from++) {
    if (countAt(board, from, color) === 0) continue;
    const to = from + dir * die;
    if (to >= 0 && to <= 23) {
      if (isOpenFor(board, to, color)) moves.push({ from, to, die });
      continue;
    }
    if (!canBearOff) continue;
    const exact = color === WHITE ? to === -1 : to === 24;
    if (exact) {
      moves.push({ from, to: 'off', die });
      continue;
    }
    // Overshoot: allowed only from the furthest occupied point.
    let furtherChecker = false;
    if (color === WHITE) {
      for (let i = from + 1; i <= 5; i++) if (countAt(board, i, color) > 0) furtherChecker = true;
    } else {
      for (let i = 18; i < from; i++) if (countAt(board, i, color) > 0) furtherChecker = true;
    }
    if (!furtherChecker) moves.push({ from, to: 'off', die });
  }
  return moves;
}

function applyMove(board, color, move) {
  const b = cloneBoard(board);
  const sign = color === WHITE ? 1 : -1;
  if (move.from === 'bar') b.bar[color] -= 1;
  else b.points[move.from] -= sign;

  if (move.to === 'off') {
    b.off[color] += 1;
  } else {
    const opp = opponent(color);
    if (countAt(b, move.to, opp) === 1) {
      b.points[move.to] = 0;
      b.bar[opp] += 1;
    }
    b.points[move.to] += sign;
  }
  return b;
}

function uniqueDice(dice) {
  return [...new Set(dice)];
}

function removeDie(dice, die) {
  const rest = dice.slice();
  rest.splice(rest.indexOf(die), 1);
  return rest;
}

// Longest number of dice that can be played from this position.
function maxPlayable(board, color, dice, memo = new Map()) {
  if (dice.length === 0) return 0;
  const key = board.points.join(',') + '|' + board.bar.w + ',' + board.bar.b + '|' + dice.join(',');
  if (memo.has(key)) return memo.get(key);
  let best = 0;
  for (const die of uniqueDice(dice)) {
    for (const m of movesForDie(board, color, die)) {
      const n = 1 + maxPlayable(applyMove(board, color, m), color, removeDie(dice, die), memo);
      if (n > best) best = n;
      if (best === dice.length) break;
    }
    if (best === dice.length) break;
  }
  memo.set(key, best);
  return best;
}

// Legal single moves right now, respecting "use as many dice as possible"
// and "if only one die can be played, play the higher one".
function legalMoves(board, color, dice) {
  if (dice.length === 0) return [];
  const memo = new Map();
  const target = maxPlayable(board, color, dice, memo);
  if (target === 0) return [];

  let candidates = [];
  for (const die of uniqueDice(dice)) {
    for (const m of movesForDie(board, color, die)) {
      const n = 1 + maxPlayable(applyMove(board, color, m), color, removeDie(dice, die), memo);
      if (n === target) candidates.push(m);
    }
  }

  if (target === 1 && dice.length === 2 && dice[0] !== dice[1]) {
    const high = Math.max(...dice);
    if (candidates.some((m) => m.die === high)) candidates = candidates.filter((m) => m.die === high);
  }
  return candidates;
}

function pipCount(board, color) {
  let pips = board.bar[color] * 25;
  for (let i = 0; i < 24; i++) {
    const n = countAt(board, i, color);
    if (n) pips += n * (color === WHITE ? i + 1 : 24 - i);
  }
  return pips;
}

// 1 = normal win, 2 = gammon, 3 = backgammon.
function winMultiplier(board, winner) {
  const loser = opponent(winner);
  if (board.off[loser] > 0) return 1;
  if (board.bar[loser] > 0) return 3;
  for (let i = 0; i < 24; i++) {
    const inWinnerHome = winner === WHITE ? i <= 5 : i >= 18;
    if (inWinnerHome && countAt(board, i, loser) > 0) return 3;
  }
  return 2;
}

function rollDie(rng = Math.random) {
  return 1 + Math.floor(rng() * 6);
}

function diceToMoves(d1, d2) {
  return d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
}

module.exports = {
  WHITE,
  BLACK,
  CHECKERS,
  opponent,
  initialBoard,
  cloneBoard,
  movesForDie,
  applyMove,
  legalMoves,
  pipCount,
  winMultiplier,
  allHome,
  rollDie,
  diceToMoves,
};
