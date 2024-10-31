const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

const rooms = new Map();
const users = new Map(); // Store user info
const chatMessages = new Map(); // Store chat messages

function checkWinner(board) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  for (let i = 0; i < lines.length; i++) {
    const [a, b, c] = lines[i];
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }

  if (board.every((cell) => cell !== null)) {
    return "draw";
  }

  return null;
}

io.on("connection", (socket) => {
  console.log("New client connected");

  socket.on("createRoom", (name) => {
    const roomCode = Math.random().toString(36).substring(7);
    rooms.set(roomCode, {
      players: [{ id: socket.id, name, symbol: "X", moveCount: 0 }],
      board: Array(9).fill(null),
      currentPlayer: "X",
      moveCount: 0,
      timer: 20,
      timerInterval: null,
      playerMoves: {
        X: [],
        O: [],
      },
      gameState: "waiting",
    });
    socket.join(roomCode);
    socket.emit("roomCreated", roomCode);
  });

  socket.on("joinRoom", ({ name, room }) => {
    if (rooms.has(room) && rooms.get(room).players.length < 2) {
      const roomData = rooms.get(room);
      roomData.players.push({ id: socket.id, name, symbol: "O", moveCount: 0 });
      socket.join(room);
      socket.emit("roomJoined", {
        room,
        opponentName: roomData.players[0].name,
      });
      socket.to(room).emit("opponentJoined", name);
    } else {
      socket.emit("joinError", "Room not found or full");
    }
  });

  socket.on("startGame", (room) => {
    if (rooms.has(room) && rooms.get(room).players.length === 2) {
      const gameState = rooms.get(room);
      gameState.board = Array(9).fill(null);
      gameState.currentPlayer = "X";
      gameState.moveCount = 0;
      gameState.players.forEach((player) => (player.moveCount = 0));
      gameState.timer = 20;
      gameState.gameState = "playing";
      gameState.playerMoves = { X: [], O: [] };
      rooms.set(room, gameState);
      io.to(room).emit("gameStarted");
      startTimer(room);
    }
  });

  socket.on("move", ({ room, board, player, timestamp, move }) => {
    if (rooms.has(room)) {
      const gameState = rooms.get(room);

      // Update board and general game state
      gameState.board = board;
      gameState.moveCount++;
      gameState.currentPlayer = gameState.currentPlayer === "X" ? "O" : "X";
      gameState.timer = 20;

      // Update player's move count
      const currentPlayer = gameState.players.find((p) => p.symbol === player);
      if (currentPlayer) {
        currentPlayer.moveCount++;
      }

      // Store the move with timestamp
      gameState.playerMoves[player].push({
        move: move,
        timestamp: timestamp,
      });

      clearInterval(gameState.timerInterval);
      rooms.set(room, gameState);

      // Emit updated board and moves
      io.to(room).emit("updateBoard", board);
      io.to(room).emit("updateMoves", {
        player,
        move: move,
        timestamp: timestamp,
        moveCount: currentPlayer.moveCount,
      });

      // Update move counts for both players
      io.to(room).emit("updateMoveCounts", {
        X: gameState.players.find((p) => p.symbol === "X").moveCount,
        O: gameState.players.find((p) => p.symbol === "O").moveCount,
      });

      const winner = checkWinner(board);
      if (winner) {
        gameState.gameState = "finished";
        io.to(room).emit("gameOver", {
          winner,
          moveCounts: {
            X: gameState.players.find((p) => p.symbol === "X").moveCount,
            O: gameState.players.find((p) => p.symbol === "O").moveCount,
          },
        });
      } else {
        startTimer(room);
      }
    }
  });

  socket.on("timeUp", ({ room }) => {
    if (rooms.has(room)) {
      const gameState = rooms.get(room);
      gameState.currentPlayer = gameState.currentPlayer === "X" ? "O" : "X";
      gameState.timer = 20;
      clearInterval(gameState.timerInterval);
      rooms.set(room, gameState);

      io.to(room).emit("turnChange", gameState.currentPlayer);
      startTimer(room);
    }
  });

  socket.on("rematch", ({ room }) => {
    if (rooms.has(room)) {
      const gameState = rooms.get(room);

      // Reset the game state
      gameState.board = Array(9).fill(null);
      gameState.currentPlayer = "X";
      gameState.moveCount = 0;
      gameState.players.forEach((player) => (player.moveCount = 0));
      gameState.timer = 20;
      gameState.gameState = "playing";
      gameState.playerMoves = { X: [], O: [] };

      rooms.set(room, gameState);

      // Emit to ALL players in the room that the game is restarting
      io.to(room).emit("rematchAccepted", {
        board: gameState.board,
        currentPlayer: gameState.currentPlayer,
        moveCount: gameState.moveCount,
        timer: gameState.timer,
        gameState: gameState.gameState,
        playerMoves: gameState.playerMoves,
      });

      // Start the timer after emitting rematch acceptance
      startTimer(room);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
    rooms.forEach((value, key) => {
      const index = value.players.findIndex(
        (player) => player.id === socket.id
      );
      if (index !== -1) {
        value.players.splice(index, 1);
        if (value.players.length === 0) {
          clearInterval(value.timerInterval);
          rooms.delete(key);
        } else {
          // Notify the remaining player
          io.to(key).emit("opponentLeft");
          // Stop the game
          clearInterval(value.timerInterval);
          rooms.set(key, { ...value, gameState: "abandoned" });
        }
      }
    });
  });

  socket.on("leaveRoom", (roomCode) => {
    rooms.forEach((value, key) => {
      if (key === roomCode) {
        const index = value.players.findIndex(
          (player) => player.id === socket.id
        );
        if (index !== -1) {
          value.players.splice(index, 1);
          if (value.players.length === 0) {
            clearInterval(value.timerInterval);
            rooms.delete(key);
          }
        }
      }
    });
  });

  socket.on("userJoined", ({ userId, username }) => {
    users.set(socket.id, { userId, username });
    socket.join("chat-room"); // Join main chat room

    // Send existing messages to newly joined user
    const existingMessages = Array.from(chatMessages.values());
    socket.emit("chatHistory", existingMessages);
  });

  socket.on("sendMessage", ({ userId, username, message }) => {
    const newMessage = {
      id: Date.now(),
      userId,
      username,
      message,
      timestamp: new Date().toISOString(),
      likes: 0,
      dislikes: 0,
      replies: [],
    };

    chatMessages.set(newMessage.id, newMessage);
    io.to("chat-room").emit("newMessage", newMessage);
  });

  socket.on("sendReply", ({ messageId, userId, username, reply }) => {
    const message = chatMessages.get(messageId);
    if (message) {
      const newReply = {
        id: Date.now(),
        userId,
        username,
        reply,
        timestamp: new Date().toISOString(),
      };

      message.replies.push(newReply);
      chatMessages.set(messageId, message);
      io.to("chat-room").emit("messageUpdated", message);
    }
  });

  socket.on("updateLikes", ({ messageId, action }) => {
    const message = chatMessages.get(messageId);
    if (message) {
      if (action === "like") message.likes++;
      if (action === "dislike") message.dislikes++;
      chatMessages.set(messageId, message);
      io.to("chat-room").emit("messageUpdated", message);
    }
  });

  // Update disconnect handler
  socket.on("disconnect", () => {
    console.log("Client disconnected");
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
    }
  });

  socket.on("deleteMessage", ({ messageId, userId }) => {
    const message = chatMessages.get(messageId);
    if (message && message.userId === userId) {
      chatMessages.delete(messageId);
      io.to("chat-room").emit("messageDeleted", messageId);
    }
  });

  socket.on("deleteReply", ({ messageId, replyId, userId }) => {
    const message = chatMessages.get(messageId);
    if (message) {
      const replyIndex = message.replies.findIndex(
        (reply) => reply.id === replyId && reply.userId === userId
      );
      if (replyIndex !== -1) {
        message.replies.splice(replyIndex, 1);
        chatMessages.set(messageId, message);
        io.to("chat-room").emit("messageUpdated", message);
      }
    }
  });

  socket.on("updateLikes", ({ messageId, action, userId }) => {
    const message = chatMessages.get(messageId);
    if (message) {
      // Create sets for likes and dislikes if they don't exist
      if (!message.likedBy) message.likedBy = new Set();
      if (!message.dislikedBy) message.dislikedBy = new Set();

      switch (action) {
        case "like":
          if (!message.likedBy.has(userId)) {
            message.likedBy.add(userId);
            message.likes = message.likedBy.size;
            // Remove dislike if exists
            if (message.dislikedBy.has(userId)) {
              message.dislikedBy.delete(userId);
              message.dislikes = message.dislikedBy.size;
            }
          }
          break;
        case "unlike":
          if (message.likedBy.has(userId)) {
            message.likedBy.delete(userId);
            message.likes = message.likedBy.size;
          }
          break;
        case "dislike":
          if (!message.dislikedBy.has(userId)) {
            message.dislikedBy.add(userId);
            message.dislikes = message.dislikedBy.size;
            // Remove like if exists
            if (message.likedBy.has(userId)) {
              message.likedBy.delete(userId);
              message.likes = message.likedBy.size;
            }
          }
          break;
        case "undislike":
          if (message.dislikedBy.has(userId)) {
            message.dislikedBy.delete(userId);
            message.dislikes = message.dislikedBy.size;
          }
          break;
      }

      // Convert sets to arrays before sending to client
      const messageToSend = {
        ...message,
        likedBy: Array.from(message.likedBy),
        dislikedBy: Array.from(message.dislikedBy)
      };
      
      chatMessages.set(messageId, message);
      io.to("chat-room").emit("messageUpdated", messageToSend);
    }
  })
  
});

function startTimer(room) {
  const gameState = rooms.get(room);
  clearInterval(gameState.timerInterval);

  gameState.timerInterval = setInterval(() => {
    if (rooms.has(room)) {
      gameState.timer--;
      rooms.set(room, gameState);
      io.to(room).emit("updateTimer", gameState.timer);

      if (gameState.timer <= 0) {
        clearInterval(gameState.timerInterval);
        gameState.currentPlayer = gameState.currentPlayer === "X" ? "O" : "X";
        gameState.timer = 20;
        rooms.set(room, gameState);
        io.to(room).emit("turnChange", gameState.currentPlayer);
        io.to(room).emit("updateTimer", gameState.timer);
        startTimer(room);
      }
    } else {
      clearInterval(gameState.timerInterval);
    }
  }, 1000);
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
