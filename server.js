const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Store messages per room (in memory — cleared on server restart)
const rooms = {};

io.on('connection', (socket) => {

  // Join a room
  socket.on('join', ({ roomKey, senderName, senderID }) => {
    socket.join(roomKey);
    socket.roomKey = roomKey;
    socket.senderName = senderName;
    socket.senderID = senderID;

    // Send existing messages to the joining user
    if (rooms[roomKey]) {
      socket.emit('history', rooms[roomKey]);
    }
  });

  // Chat message or image
  socket.on('message', (msg) => {
    const key = socket.roomKey;
    if (!key) return;
    if (!rooms[key]) rooms[key] = [];
    // Avoid duplicates
    if (!rooms[key].some(m => m.time === msg.time && m.sender === msg.sender)) {
      rooms[key].push(msg);
      if (rooms[key].length > 200) rooms[key].splice(0, rooms[key].length - 200);
    }
    // Broadcast to everyone else in the room
    socket.to(key).emit('message', msg);
  });

  // Delete all messages
  socket.on('delete', () => {
    const key = socket.roomKey;
    if (!key) return;
    rooms[key] = [];
    socket.to(key).emit('delete');
  });

  // WebRTC signaling — forward to others in room
  socket.on('call-offer',  (data) => socket.to(socket.roomKey).emit('call-offer', data));
  socket.on('call-answer', (data) => socket.to(socket.roomKey).emit('call-answer', data));
  socket.on('ice',         (data) => socket.to(socket.roomKey).emit('ice', data));
  socket.on('call-end',    ()     => socket.to(socket.roomKey).emit('call-end'));
  socket.on('call-reject', ()     => socket.to(socket.roomKey).emit('call-reject'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port', PORT));
