const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

// Create express app
const app = express();

// Apply CORS middleware
app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// Create HTTP server
const httpServer = createServer(app);

// Create Socket.IO server
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["polling", "websocket"],
  cookie: false,
});

// Store active rooms
const rooms = new Map();

function generateGameId() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Add a basic route for testing
app.get("/", (req, res) => {
  res.send("Game server is running");
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("createRoom", () => {
    try {
      const gameId = generateGameId();
      rooms.set(gameId, { host: socket.id, guest: null });
      socket.join(gameId);
      console.log(`Room created: ${gameId} by ${socket.id}`);
      socket.emit("roomCreated", gameId);
    } catch (error) {
      console.error("Error creating room:", error);
      socket.emit("error", "Failed to create room");
    }
  });

  socket.on("joinRoom", (gameId) => {
    try {
      console.log(`Join attempt for room: ${gameId} by ${socket.id}`);
      const room = rooms.get(gameId);

      if (!room) {
        socket.emit("joinError", "Room not found");
        return;
      }

      if (room.guest) {
        socket.emit("joinError", "Room is full");
        return;
      }

      room.guest = socket.id;
      socket.join(gameId);
      socket.emit("joinedRoom");
      socket.to(gameId).emit("playerJoined");
      io.to(gameId).emit("startGame"); // Start game after player joins
      console.log(`Player ${socket.id} joined room ${gameId}`);
    } catch (error) {
      console.error("Error joining room:", error);
      socket.emit("error", "Failed to join room");
    }
  });

  socket.on("move", ({ index, gameId }) => {
    console.log(`Move received: ${index} for game ${gameId}`);
    socket.to(gameId).emit("opponentMove", { index });
    io.to(gameId).emit("nextTurn", { gameId }); // Emit next turn event
  });

  socket.on("shift", ({ from, to, gameId }) => {
    console.log(`Shift received: from ${from} to ${to} for game ${gameId}`);
    socket.to(gameId).emit("opponentShift", { from, to });
    io.to(gameId).emit("nextTurn", { gameId }); // Emit next turn event
  });

  socket.on("startGame", (gameId) => {
    console.log(`Game started: ${gameId}`);
    io.to(gameId).emit("gameStarted");
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    for (const [gameId, room] of rooms.entries()) {
      if (room.host === socket.id || room.guest === socket.id) {
        io.to(gameId).emit("playerDisconnected");
        rooms.delete(gameId);
        console.log(`Room ${gameId} deleted due to player disconnect`);
      }
    }
  });
});

// Error handling for the server
httpServer.on("error", (error) => {
  console.error("Server error:", error);
});

// Start server
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (error) => {
  console.error("Unhandled Rejection:", error);
});
