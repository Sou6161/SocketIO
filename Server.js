const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

let rooms = {};

io.on("connection", (socket) => {
  console.log("New connection");

  socket.on("createRoom", (roomId, playerName) => {
    rooms[roomId] = {
      players: [playerName],
      started: false,
    };
    socket.join(roomId);
    console.log(`Room ${roomId} created`);
  });

  socket.on("joinRoom", (roomId, playerName) => {
    if (rooms[roomId] && rooms[roomId].players.length < 2) {
      rooms[roomId].players.push(playerName);
      socket.join(roomId);
      io.to(roomId).emit("roomJoined");
      console.log(`Player ${playerName} joined room ${roomId}`);
    } else {
      socket.emit("roomJoinError", "Room is full or does not exist");
    }
  });

  socket.on("disconnect", () => {
    console.log("Disconnected");
  });

  socket.on("makeMove", (roomId, move) => {
    io.to(roomId).emit("opponentMove", move);
  });

  socket.on("gameStarted", (roomId) => {
    rooms[roomId].started = true;
    io.to(roomId).emit("gameStarted");
  });

  socket.on("gameEnded", (roomId) => {
    rooms[roomId].started = false;
    io.to(roomId).emit("gameEnded");
  });
});

http.listen(8080, () => {
  console.log("Server listening on port 8080");
});