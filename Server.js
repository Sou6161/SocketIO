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

// Store active rooms with game state
const rooms = new Map();

function generateGameId() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Check if a room exists and is valid
function isValidRoom(gameId) {
  return rooms.has(gameId) && rooms.get(gameId).host && rooms.get(gameId).guest;
}

// Add a basic route for testing
app.get("/", (req, res) => {
  res.send("Game server is running");
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Create a new game room
  socket.on("createRoom", () => {
    try {
      const gameId = generateGameId();
      rooms.set(gameId, {
        host: socket.id,
        guest: null,
        currentPlayer: "X",
        board: Array(9).fill(null),
        movesX: 0,
        movesO: 0,
        gameStarted: false
      });
      
      socket.join(gameId);
      socket.gameId = gameId;
      
      console.log(`Room created: ${gameId} by ${socket.id}`);
      socket.emit("roomCreated", gameId);
    } catch (error) {
      console.error("Error creating room:", error);
      socket.emit("error", "Failed to create room");
    }
  });

  // Join an existing game room
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
      room.gameStarted = true;
      socket.gameId = gameId;
      socket.join(gameId);

      // Emit initial game state to both players
      io.to(gameId).emit("gameState", {
        board: room.board,
        currentPlayer: room.currentPlayer,
        movesX: room.movesX,
        movesO: room.movesO
      });

      socket.emit("joinedRoom", {
        gameId,
        isHost: false,
        playerSymbol: "O"
      });

      io.to(room.host).emit("playerJoined", {
        gameId,
        isHost: true,
        playerSymbol: "X"
      });

      console.log(`Player ${socket.id} joined room ${gameId}`);
    } catch (error) {
      console.error("Error joining room:", error);
      socket.emit("error", "Failed to join room");
    }
  });

  // Handle a player's move
  socket.on("move", ({ index, gameId }) => {
    try {
      if (!isValidRoom(gameId)) {
        socket.emit("error", "Invalid game room");
        return;
      }

      const room = rooms.get(gameId);
      const isPlayerX = socket.id === room.host;
      
      if ((isPlayerX && room.currentPlayer !== "X") || 
          (!isPlayerX && room.currentPlayer !== "O")) {
        socket.emit("error", "Not your turn");
        return;
      }

      if (room.board[index] !== null) {
        socket.emit("error", "Invalid move");
        return;
      }

      // Update game state
      room.board[index] = room.currentPlayer;
      if (room.currentPlayer === "X") {
        room.movesX++;
      } else {
        room.movesO++;
      }

      // Broadcast the move to all players in the room
      io.to(gameId).emit("gameState", {
        board: room.board,
        currentPlayer: room.currentPlayer,
        movesX: room.movesX,
        movesO: room.movesO
      });

      // Emit move to opponent
      socket.to(gameId).emit("opponentMove", { index });

      // Switch turns
      room.currentPlayer = room.currentPlayer === "X" ? "O" : "X";
      io.to(gameId).emit("nextTurn", { currentPlayer: room.currentPlayer });

    } catch (error) {
      console.error("Error processing move:", error);
      socket.emit("error", "Failed to process move");
    }
  });

  // Handle a player's shift
  socket.on("shift", ({ from, to, gameId }) => {
    try {
      if (!isValidRoom(gameId)) {
        socket.emit("error", "Invalid game room");
        return;
      }

      const room = rooms.get(gameId);
      const isPlayerX = socket.id === room.host;
      
      if ((isPlayerX && room.currentPlayer !== "X") || 
          (!isPlayerX && room.currentPlayer !== "O")) {
        socket.emit("error", "Not your turn");
        return;
      }

      if (room.board[from] !== room.currentPlayer || room.board[to] !== null) {
        socket.emit("error", "Invalid shift");
        return;
      }

      // Update game state
      room.board[to] = room.board[from];
      room.board[from] = null;

      // Broadcast the updated game state
      io.to(gameId).emit("gameState", {
        board: room.board,
        currentPlayer: room.currentPlayer,
        movesX: room.movesX,
        movesO: room.movesO
      });

      socket.to(gameId).emit("opponentShift", { from, to });

      // Switch turns
      room.currentPlayer = room.currentPlayer === "X" ? "O" : "X";
      io.to(gameId).emit("nextTurn", { currentPlayer: room.currentPlayer });

    } catch (error) {
      console.error("Error processing shift:", error);
      socket.emit("error", "Failed to process shift");
    }
  });

  // Handle game start
  socket.on("startGame", (gameId) => {
    try {
      if (!isValidRoom(gameId)) {
        socket.emit("error", "Invalid game room");
        return;
      }

      const room = rooms.get(gameId);
      if (!room.gameStarted) {
        room.gameStarted = true;
        io.to(gameId).emit("gameStarted");
      }
    } catch (error) {
      console.error("Error starting game:", error);
      socket.emit("error", "Failed to start game");
    }
  });

  // Handle player disconnect
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