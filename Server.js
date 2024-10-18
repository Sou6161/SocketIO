const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map();

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

  if (board.every(cell => cell !== null)) {
    return 'draw';
  }

  return null;
}

io.on('connection', (socket) => {
  console.log('New client connected');

  socket.on('createRoom', (name) => {
    const roomCode = Math.random().toString(36).substring(7);
    rooms.set(roomCode, { 
      players: [{ id: socket.id, name }], 
      board: Array(9).fill(null), 
      currentPlayer: 'X', 
      moveCount: 0 
    });
    socket.join(roomCode);
    socket.emit('roomCreated', roomCode);
  });

  socket.on('joinRoom', ({ name, room }) => {
    if (rooms.has(room) && rooms.get(room).players.length < 2) {
      const roomData = rooms.get(room);
      roomData.players.push({ id: socket.id, name });
      socket.join(room);
      socket.emit('roomJoined', { room, opponentName: roomData.players[0].name });
      socket.to(room).emit('opponentJoined', name);
      io.to(room).emit('gameReady'); // Emit gameReady event to both clients
    } else {
      socket.emit('joinError', 'Room not found or full');
    }
  });

  socket.on('startGame', (room) => {
    if (rooms.has(room) && rooms.get(room).players.length === 2) {
      const gameState = rooms.get(room);
      gameState.board = Array(9).fill(null);
      gameState.currentPlayer = 'X';
      gameState.moveCount = 0;
      gameState.timer = 30;
      rooms.set(room, gameState);
      io.to(room).emit('gameStarted');
      startTimer(room);
    }
  });

  socket.on('move', ({ room, board }) => {
    if (rooms.has(room)) {
      const gameState = rooms.get(room);
      gameState.board = board;
      gameState.moveCount++;
      gameState.currentPlayer = gameState.currentPlayer === 'X' ? 'O' : 'X';
      gameState.timer = 30;
      rooms.set(room, gameState);
  
      io.to(room).emit('updateBoard', board);
      io.to(room).emit('updateTimer', gameState.timer);
  
      const winner = checkWinner(board);
      if (winner) {
        io.to(room).emit('gameOver', winner);
      } else {
        startTimer(room);
      }
    }
  });

  socket.on('timeUp', ({ room }) => {
    if (rooms.has(room)) {
      const gameState = rooms.get(room);
      gameState.currentPlayer = gameState.currentPlayer === 'X' ? 'O' : 'X';
      gameState.timer = 30;
      rooms.set(room, gameState);

      io.to(room).emit('turnChange', gameState.currentPlayer);
      io.to(room).emit('updateTimer', gameState.timer);
      startTimer(room);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
    rooms.forEach((value, key) => {
      const index = value.players.findIndex(player => player.id === socket.id);
      if (index !== -1) {
        value.players.splice(index, 1);
        if (value.players.length === 0) {
          rooms.delete(key);
        } else {
          io.to(key).emit('playerLeft', value.players[index].name);
        }
      }
    });
  });
});

function startTimer(room) {
  const interval = setInterval(() => {
    if (rooms.has(room)) {
      const gameState = rooms.get(room);
      gameState.timer--;
      rooms.set(room, gameState);
      io.to(room).emit('updateTimer', gameState.timer);

      if (gameState.timer <= 0) {
        clearInterval(interval);
        gameState.currentPlayer = gameState.currentPlayer === 'X' ? 'O' : 'X';
        gameState.timer = 30;
        rooms.set(room, gameState);
        io.to(room).emit('updateBoard', gameState.board);
        io.to(room).emit('updateTimer', gameState.timer);
        startTimer(room);
      }
    } else {
      clearInterval(interval);
    }
  }, 1000);
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));