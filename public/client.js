'use strict';

(() => {
  // ---------- persistence ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  let token = store.get('bg.token');
  if (!token) {
    token = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
    store.set('bg.token', token);
  }

  const $ = (id) => document.getElementById(id);
  const socket = io();
  let state = null;
  let selected = null;
  let lastDiceKey = '';
  let lastTurn = null;

  // ---------- screens ----------
  function show(screen) {
    for (const id of ['lobby', 'waiting', 'game']) $(id).hidden = id !== screen;
  }

  function toast(text, ms = 2200) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, ms);
  }

  function lobbyError(text) {
    const e = $('lobbyError');
    e.textContent = text || '';
    e.hidden = !text;
  }

  // ---------- lobby ----------
  $('name').value = store.get('bg.name') || '';
  const urlCode = new URLSearchParams(location.search).get('code');
  if (urlCode) $('codeInput').value = urlCode.replace(/\D/g, '').slice(0, 4);

  function playerName() {
    const n = $('name').value.trim();
    store.set('bg.name', n);
    return n;
  }

  function afterEnter(res) {
    if (!res.ok) {
      lobbyError(res.error);
      store.del('bg.code');
      show('lobby');
      return;
    }
    lobbyError('');
    store.set('bg.code', res.code);
    if (urlCode) history.replaceState(null, '', location.pathname);
  }

  $('createBtn').onclick = () => {
    socket.emit('create', { token, name: playerName() }, afterEnter);
  };

  function join() {
    const code = $('codeInput').value.replace(/\D/g, '');
    if (code.length !== 4) return lobbyError('הקוד צריך להיות 4 ספרות');
    socket.emit('join', { code, token, name: playerName() }, afterEnter);
  }
  $('joinBtn').onclick = join;
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

  for (const b of document.querySelectorAll('.leaveBtn')) {
    b.onclick = () => {
      store.del('bg.code');
      state = null;
      location.href = location.pathname;
    };
  }

  // ---------- waiting ----------
  function shareUrl() {
    return `${location.origin}${location.pathname}?code=${state.code}`;
  }
  $('shareBtn').onclick = async () => {
    const text = `בוא לשחק איתי שש-בש! קוד המשחק: ${state.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'שש-בש', text, url: shareUrl() }); } catch {}
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(text + '\n' + shareUrl())}`, '_blank');
    }
  };
  $('copyBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(state.code); toast('הקוד הועתק'); } catch { toast(state.code); }
  };

  // ---------- socket ----------
  socket.on('connect', () => {
    const code = store.get('bg.code');
    if (code) socket.emit('join', { code, token, name: store.get('bg.name') || '' }, afterEnter);
    else show('lobby');
  });
  socket.on('disconnect', () => { if (state) toast('החיבור נותק… מתחבר מחדש', 4000); });

  socket.on('state', (s) => {
    const myTurnNow = s.turn === s.you && s.phase !== 'gameover';
    if (myTurnNow && lastTurn !== s.you && state && navigator.vibrate) navigator.vibrate(80);
    lastTurn = s.turn;
    state = s;
    const legalFrom = new Set(s.legal.map((m) => m.from));
    if (selected !== null && !legalFrom.has(selected)) selected = null;
    if (legalFrom.has('bar')) selected = 'bar';
    if (s.phase === 'waiting') {
      $('bigCode').textContent = s.code;
      show('waiting');
    } else {
      show('game');
      render();
    }
  });

  function send(event, payload) {
    socket.emit(event, payload || {}, (res) => { if (!res.ok) toast(res.error); });
  }

  // ---------- board geometry ----------
  const SVGNS = 'http://www.w3.org/2000/svg';
  const PW = 26;          // point width
  const R = 12.4;         // checker radius
  const TOP = 8, BOTTOM = 432, PH = 172;
  const BAR_X = 164, BAR_W = 24;
  const TRAY_X = 350, TRAY_W = 24;
  const MID_Y = 220;
  const MAX_STACK = 5;

  // Display index: 0 = viewer's 1-point (bottom right), counting toward 23 (top right).
  const toDisplay = (i) => (state.you === 'w' ? i : 23 - i);
  function colX(d) {
    if (d < 6) return 344 - (d + 1) * PW;
    if (d < 12) return 164 - (d - 5) * PW;
    if (d < 18) return 8 + (d - 12) * PW;
    return 188 + (d - 18) * PW;
  }
  const isTop = (d) => d >= 12;
  function slotY(d, k) {
    return isTop(d) ? TOP + R + k * 2 * R : BOTTOM - R - k * 2 * R;
  }

  function el(tag, attrs, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function checker(parent, cx, cy, color, label) {
    el('circle', { cx, cy, r: R, fill: `url(#chk-${color})`, stroke: color === 'w' ? '#9c8a6e' : '#000', 'stroke-width': 1 }, parent);
    el('circle', { cx, cy, r: R * 0.62, fill: 'none', stroke: color === 'w' ? '#d8c9ae' : '#4a4a4a', 'stroke-width': 1 }, parent);
    if (label) {
      const t = el('text', { x: cx, y: cy + 4.5, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: color === 'w' ? '#5a3d1e' : '#f5e6d0' }, parent);
      t.textContent = label;
    }
  }

  const PIPS = {
    1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  };
  function die(parent, cx, cy, value, color, used, size, animate) {
    const g = el('g', { opacity: used ? 0.3 : 1 }, parent);
    if (animate) g.setAttribute('class', 'die-rolling');
    const fill = color === 'w' ? '#fdf8ef' : '#2b2b2b';
    const dot = color === 'w' ? '#222' : '#fdf8ef';
    el('rect', { x: cx - size / 2, y: cy - size / 2, width: size, height: size, rx: size * 0.18, fill, stroke: '#000', 'stroke-width': 1 }, g);
    for (const [dx, dy] of PIPS[value]) {
      el('circle', { cx: cx + dx * size * 0.27, cy: cy + dy * size * 0.27, r: size * 0.09, fill: dot }, g);
    }
  }

  // ---------- render ----------
  function render() {
    const s = state;
    const me = s.you;
    const opp = me === 'w' ? 'b' : 'w';
    const myTurn = s.turn === me && s.phase === 'move';

    // players header
    const box = (color, elId) => {
      const p = s.players[color];
      const b = $(elId);
      b.className = 'player' + (s.turn === color && s.phase !== 'gameover' ? ' active' : '') + (p && !p.connected ? ' off' : '');
      b.innerHTML = '';
      const chip = document.createElement('span');
      chip.className = 'chip ' + color;
      const info = document.createElement('span');
      info.className = 'info';
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = p ? p.name + (color === me ? ' (את/ה)' : '') : '—';
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `ניקוד ${s.score[color]} · ${s.pips[color]} צעדים`;
      info.append(nm, meta);
      b.append(chip, info);
    };
    box(opp, 'oppBox');
    box(me, 'meBox');
    $('codeTag').textContent = s.code;

    const legal = s.legal;
    const sources = new Set(legal.map((m) => m.from));
    const targets = selected === null ? [] : legal.filter((m) => m.from === selected).map((m) => m.to);

    const svg = $('board');
    svg.innerHTML = '';
    const defs = el('defs', {}, svg);
    const grad = (id, c1, c2) => {
      const g = el('radialGradient', { id, cx: '35%', cy: '30%', r: '75%' }, defs);
      el('stop', { offset: '0%', 'stop-color': c1 }, g);
      el('stop', { offset: '100%', 'stop-color': c2 }, g);
    };
    grad('chk-w', '#ffffff', '#e6d6bb');
    grad('chk-b', '#5a5a5a', '#111111');

    // frame & felt
    el('rect', { x: 0, y: 0, width: 380, height: 440, rx: 10, fill: '#5b3a1f' }, svg);
    el('rect', { x: 8, y: TOP, width: 156, height: BOTTOM - TOP, fill: '#d9b98a' }, svg);
    el('rect', { x: 188, y: TOP, width: 156, height: BOTTOM - TOP, fill: '#d9b98a' }, svg);
    el('rect', { x: BAR_X, y: 0, width: BAR_W, height: 440, fill: '#4a2e17' }, svg);
    el('rect', { x: TRAY_X, y: TOP, width: TRAY_W, height: BOTTOM - TOP, rx: 4, fill: '#3e2612' }, svg);
    el('line', { x1: TRAY_X, y1: MID_Y, x2: TRAY_X + TRAY_W, y2: MID_Y, stroke: '#5b3a1f', 'stroke-width': 2 }, svg);

    // triangles
    for (let d = 0; d < 24; d++) {
      const x = colX(d);
      const top = isTop(d);
      const dark = d % 2 === 0;
      const tipY = top ? TOP + PH : BOTTOM - PH;
      const baseY = top ? TOP : BOTTOM;
      el('polygon', {
        points: `${x},${baseY} ${x + PW},${baseY} ${x + PW / 2},${tipY}`,
        fill: dark ? '#8e2a1c' : '#f3e3c3',
        stroke: '#6b4a2a', 'stroke-width': 0.5,
      }, svg);
    }

    // last move highlight (opponent's move, or the one being played now)
    const showMoves = s.turn === me ? (s.currentMoves.length ? [] : s.lastTurnMoves) : s.currentMoves;
    for (const m of showMoves) {
      if (m.to === 'off') continue;
      const d = toDisplay(m.to);
      el('rect', { class: 'last-move', x: colX(d), y: isTop(d) ? TOP : BOTTOM - PH, width: PW, height: PH }, svg);
    }

    // checkers on points
    for (let i = 0; i < 24; i++) {
      const v = s.board.points[i];
      if (!v) continue;
      const color = v > 0 ? 'w' : 'b';
      const n = Math.abs(v);
      const d = toDisplay(i);
      const cx = colX(d) + PW / 2;
      const shown = Math.min(n, MAX_STACK);
      for (let k = 0; k < shown; k++) {
        checker(svg, cx, slotY(d, k), color, k === shown - 1 && n > MAX_STACK ? String(n) : '');
      }
      if (myTurn && sources.has(i)) {
        el('circle', { class: selected === i ? 'selected-ring' : 'source-ring', cx, cy: slotY(d, shown - 1), r: R + 1 }, svg);
      }
    }

    // bar: my checkers below centre, opponent's above
    const barCx = BAR_X + BAR_W / 2;
    const drawBar = (color, dir) => {
      const n = s.board.bar[color];
      const shown = Math.min(n, 3);
      for (let k = 0; k < shown; k++) {
        const cy = MID_Y + dir * (R + 18 + k * 2 * R);
        checker(svg, barCx, cy, color, k === shown - 1 && n > 1 ? String(n) : '');
      }
      if (color === me && myTurn && sources.has('bar') && n) {
        el('circle', { class: selected === 'bar' ? 'selected-ring' : 'source-ring', cx: barCx, cy: MID_Y + dir * (R + 18), r: R + 1 }, svg);
      }
    };
    drawBar(me, 1);
    drawBar(opp, -1);

    // borne-off checkers: mine at the bottom of the tray, opponent's at the top
    const drawOff = (color, bottom) => {
      for (let k = 0; k < s.board.off[color]; k++) {
        const y = bottom ? BOTTOM - 4 - (k + 1) * 9 : TOP + 4 + k * 9;
        el('rect', { x: TRAY_X + 2, y, width: TRAY_W - 4, height: 8, rx: 2, fill: color === 'w' ? '#f3e8d4' : '#1c1c1c', stroke: color === 'w' ? '#9c8a6e' : '#555', 'stroke-width': 0.6 }, svg);
      }
    };
    drawOff(me, true);
    drawOff(opp, false);

    // move targets
    for (const to of targets) {
      if (to === 'off') {
        el('rect', { class: 'target', x: TRAY_X, y: MID_Y, width: TRAY_W, height: BOTTOM - MID_Y, rx: 4 }, svg);
        continue;
      }
      const d = toDisplay(to);
      const v = s.board.points[to];
      const ownCount = (me === 'w' ? v > 0 : v < 0) ? Math.abs(v) : 0;
      el('circle', { class: 'target', cx: colX(d) + PW / 2, cy: slotY(d, Math.min(ownCount, MAX_STACK - 1)), r: R }, svg);
    }

    // dice in the middle band of the side whose turn it is
    if (s.dice.length) {
      const full = s.dice[0] === s.dice[1] ? [s.dice[0], s.dice[0], s.dice[0], s.dice[0]] : s.dice.slice();
      const rem = s.remaining.slice();
      const usedFlags = full.map(() => true);
      for (let k = 0; k < full.length; k++) {
        const idx = rem.indexOf(full[k]);
        if (idx >= 0) { usedFlags[k] = false; rem.splice(idx, 1); }
      }
      const diceKey = `${s.gameNumber}-${s.turn}-${s.dice.join(',')}-${s.phase}`;
      const animate = diceKey !== lastDiceKey;
      lastDiceKey = diceKey;
      const size = full.length > 2 ? 26 : 30;
      const gap = size + 6;
      const centerX = s.turn === me ? 266 : 86;
      const startX = centerX - ((full.length - 1) * gap) / 2;
      full.forEach((v, k) => die(svg, startX + k * gap, MID_Y, v, s.turn, s.phase === 'move' && usedFlags[k], size, animate));
    }

    // tap areas (on top of everything)
    for (let i = 0; i < 24; i++) {
      const d = toDisplay(i);
      const r = el('rect', {
        class: 'pt', x: colX(d), y: isTop(d) ? 0 : MID_Y, width: PW, height: MID_Y, fill: 'transparent',
      }, svg);
      r.addEventListener('click', () => onPointTap(i));
    }
    el('rect', { class: 'pt', x: BAR_X, y: MID_Y, width: BAR_W, height: 440 - MID_Y, fill: 'transparent' }, svg)
      .addEventListener('click', () => onPointTap('bar'));
    el('rect', { class: 'pt', x: TRAY_X - 4, y: 0, width: 380 - TRAY_X + 4, height: 440, fill: 'transparent' }, svg)
      .addEventListener('click', () => onPointTap('off'));

    renderControls();
  }

  function renderControls() {
    const s = state;
    const me = s.you;
    const oppName = s.players[me === 'w' ? 'b' : 'w']?.name || 'היריב';
    const main = $('mainBtn');
    const undo = $('undoBtn');
    let status = s.message || '';

    undo.disabled = !s.canUndo;
    main.disabled = true;
    main.onclick = null;

    if (s.phase === 'gameover') {
      main.textContent = 'המשחק נגמר';
    } else if (s.turn !== me) {
      main.textContent = `התור של ${oppName}`;
      if (!status) status = s.phase === 'roll' ? `${oppName} מטיל קוביות…` : `${oppName} משחק…`;
    } else if (s.phase === 'roll') {
      main.textContent = '🎲 הטל קוביות';
      main.disabled = false;
      main.onclick = () => send('roll');
      if (!status) status = 'התור שלך!';
    } else if (s.canEndTurn) {
      const none = s.currentMoves.length === 0;
      main.textContent = none ? 'אין מהלכים – העבר תור' : '✓ סיים תור';
      main.disabled = false;
      main.onclick = () => send('endTurn');
      if (!status || !none) status = none ? 'אין לך מהלכים חוקיים בהטלה הזו' : 'סיימת לשחק – אשר או בטל';
    } else {
      main.textContent = 'בחר כלי להזזה';
      if (!status) status = selected === null ? 'גע בכלי (מסומן בצהוב) כדי להזיז' : 'גע ביעד המסומן בירוק';
    }
    $('status').textContent = status;

    const over = $('gameOver');
    over.hidden = s.phase !== 'gameover';
    if (s.phase === 'gameover') {
      const won = s.winner === me;
      $('gameOverTitle').textContent = (won ? '🏆 ניצחת!' : `${s.players[s.winner].name} ניצח`) +
        (s.multiplier === 2 ? ' (מארס)' : s.multiplier === 3 ? ' (טורקי מארס)' : '');
      $('gameOverScore').textContent = `ניקוד – ${s.players.w.name}: ${s.score.w} · ${s.players.b.name}: ${s.score.b}`;
      const voted = s.rematchVotes[me];
      const rb = $('rematchBtn');
      rb.disabled = voted;
      rb.textContent = voted ? 'ממתין לחבר…' : 'משחק נוסף';
      rb.onclick = () => send('rematch');
    }
  }

  $('undoBtn').onclick = () => { selected = null; send('undo'); };

  function onPointTap(where) {
    const s = state;
    if (!s || s.phase !== 'move' || s.turn !== s.you) return;
    const legal = s.legal;
    if (selected !== null && legal.some((m) => m.from === selected && m.to === where)) {
      const from = selected;
      selected = null;
      send('move', { from, to: where });
      return;
    }
    if (where !== 'off' && legal.some((m) => m.from === where)) {
      selected = selected === where && where !== 'bar' ? null : where;
    } else {
      selected = null;
    }
    render();
  }
})();
