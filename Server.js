const express = require("express");
const app = express();
const server = require("http").createServer(app);
const io = require("socket.io")(server, {
  cors: {
    origin: "*",
  },
});

let rooms = {};
const connectedUsers = new Set();

io.on("connection", (socket) => {
  connectedUsers.add(socket.id);
  console.log(`User connected: ${socket.id}`);

  socket.on("createRoom", () => {
    console.log(`Room creation requested by: ${socket.id}`);
    const roomCode = Math.random().toString(36).substr(2, 5).toUpperCase();
    rooms[roomCode] = { players: [socket.id], messages: [] };
    socket.join(roomCode);
    socket.emit("roomCreated", roomCode);
    console.log(`Room created: ${roomCode}`);
  });

  socket.on("joinRoom", (roomCode) => {
    if (rooms[roomCode] && rooms[roomCode].players.length < 2) {
      rooms[roomCode].players.push(socket.id);
      socket.join(roomCode);
      socket.emit("roomJoined", roomCode);
      io.to(roomCode).emit("newPlayerJoined", socket.id);
    } else {
      socket.emit("roomFull");
    }
  });

  socket.on("sendMessage", (roomCode, message) => {
    if (rooms[roomCode]) {
      rooms[roomCode].messages.push(message);
      io.to(roomCode).emit("newMessage", message);
    }
  });

  socket.on("disconnect", () => {
    connectedUsers.delete(socket.id);
    console.log(`User disconnected: ${socket.id}`);
    for (const roomCode in rooms) {
      if (rooms[roomCode].players.includes(socket.id)) {
        rooms[roomCode].players = rooms[roomCode].players.filter(
          (player) => player !== socket.id
        );
        io.to(roomCode).emit("playerLeft", socket.id);
      }
    }
  });

  socket.on("error", (err) => {
    console.log("Socket error:", err);
  });
});

server.listen(8080, () => {
  console.log("Socket.IO server listening on port 8080");
});