'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { Room, GameError } = require('./src/room');

const PORT = process.env.PORT || 3000;
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();

function newCode() {
  for (let i = 0; i < 1000; i++) {
    const code = String(crypto.randomInt(1000, 10000));
    if (!rooms.has(code)) return code;
  }
  throw new GameError('השרת עמוס, נסו שוב');
}

function cleanName(name) {
  return String(name || '').trim().slice(0, 16);
}

function broadcast(room) {
  for (const s of io.sockets.adapter.rooms.get(room.code) || []) {
    const sock = io.sockets.sockets.get(s);
    if (sock && sock.data.color) sock.emit('state', room.viewFor(sock.data.color));
  }
}

io.on('connection', (socket) => {
  const handle = (fn) => (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      reply({ ok: true, ...(fn(payload || {}) || {}) });
    } catch (err) {
      if (!(err instanceof GameError)) console.error(err);
      reply({ ok: false, error: err instanceof GameError ? err.message : 'שגיאה בשרת' });
    }
  };

  const enter = (room, token, name) => {
    const color = room.join(token, cleanName(name));
    socket.data = { code: room.code, token, color };
    socket.join(room.code);
    broadcast(room);
    return { code: room.code, color };
  };

  const current = () => {
    const room = socket.data && rooms.get(socket.data.code);
    if (!room) throw new GameError('המשחק לא נמצא');
    return room;
  };

  const act = (fn) =>
    handle((p) => {
      const room = current();
      fn(room, socket.data.color, p);
      broadcast(room);
    });

  socket.on('create', handle(({ token, name }) => {
    if (!token) throw new GameError('חסר מזהה שחקן');
    const room = new Room(newCode());
    rooms.set(room.code, room);
    return enter(room, token, name);
  }));

  socket.on('join', handle(({ code, token, name }) => {
    if (!token) throw new GameError('חסר מזהה שחקן');
    const room = rooms.get(String(code || '').trim());
    if (!room) throw new GameError('לא נמצא משחק עם הקוד הזה');
    return enter(room, token, name);
  }));

  socket.on('roll', act((room, color) => room.roll(color)));
  socket.on('move', act((room, color, { from, to }) => room.move(color, from, to)));
  socket.on('undo', act((room, color) => room.undo(color)));
  socket.on('endTurn', act((room, color) => room.endTurn(color)));
  socket.on('rematch', act((room, color) => room.requestRematch(color)));

  socket.on('disconnect', () => {
    const room = socket.data && rooms.get(socket.data.code);
    if (!room) return;
    const stillHere = [...(io.sockets.adapter.rooms.get(room.code) || [])].some(
      (id) => io.sockets.sockets.get(id)?.data.token === socket.data.token,
    );
    if (!stillHere) {
      room.setConnected(socket.data.token, false);
      broadcast(room);
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) if (now - room.lastActivity > ROOM_TTL_MS) rooms.delete(code);
}, 10 * 60 * 1000).unref();

server.listen(PORT, () => console.log(`Backgammon server listening on http://localhost:${PORT}`));
