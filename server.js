const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
});

app.use(express.static(path.join(__dirname, 'public')));

// Rooms en mémoire
const rooms = {};

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

function getRoomState(room) {
  return {
    code: room.code,
    status: room.status,
    buzzedBy: room.buzzedBy,
    players: room.players,
    teams: room.teams,
    round: room.round,
    currentTrack: room.currentTrack,
  };
}

io.on('connection', (socket) => {
  console.log('Client connecté:', socket.id);

  // ─── ANIMATEUR ────────────────────────────────────────────────

  socket.on('create-room', (callback) => {
    let code;
    do { code = generateCode(); } while (rooms[code]);

    rooms[code] = {
      hostSocketId: socket.id,
      code,
      status: 'lobby',
      buzzedBy: null,
      players: {},
      teams: {},
      currentTrack: null,
      round: 1,
    };

    socket.join(code);
    socket.roomCode = code;
    socket.isHost = true;

    callback({ success: true, code });
    console.log(`Room créée: ${code} par ${socket.id}`);
  });

  socket.on('get-room', ({ code }, callback) => {
    const room = rooms[code];
    if (!room) return callback({ success: false, error: 'Partie introuvable' });
    callback({ success: true, room: getRoomState(room) });
  });

  // Démarrer / mettre en pause la partie
  socket.on('set-status', ({ status }) => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;
    room.status = status;
    if (status !== 'buzzed') room.buzzedBy = null;
    io.to(socket.roomCode).emit('status-changed', { status, buzzedBy: room.buzzedBy });
  });

  // Reset buzz → remet en mode "playing"
  socket.on('reset-buzz', () => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;
    room.status = 'playing';
    room.buzzedBy = null;
    io.to(socket.roomCode).emit('buzz-reset');
  });

  // Modifier le score d'un joueur (delta ou valeur absolue)
  socket.on('update-score', ({ playerId, delta, absolute }) => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;
    if (!room.players[playerId]) return;

    if (absolute !== undefined) {
      room.players[playerId].score = absolute;
    } else if (delta !== undefined) {
      room.players[playerId].score = Math.max(0, room.players[playerId].score + delta);
    }

    io.to(socket.roomCode).emit('scores-updated', {
      players: room.players,
      teams: room.teams,
    });
  });

  // Modifier le score d'une équipe
  socket.on('update-team-score', ({ teamId, delta, absolute }) => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;
    if (!room.teams[teamId]) return;

    if (absolute !== undefined) {
      room.teams[teamId].score = absolute;
    } else if (delta !== undefined) {
      room.teams[teamId].score = Math.max(0, room.teams[teamId].score + delta);
    }

    io.to(socket.roomCode).emit('scores-updated', {
      players: room.players,
      teams: room.teams,
    });
  });

  // Créer une équipe
  socket.on('create-team', ({ name, color }, callback) => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;

    const teamId = generateId();
    room.teams[teamId] = { id: teamId, name, color, score: 0 };

    io.to(socket.roomCode).emit('teams-updated', { teams: room.teams });
    if (callback) callback({ success: true, teamId });
  });

  // Supprimer une équipe
  socket.on('delete-team', ({ teamId }) => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;

    // Désassigner les joueurs de cette équipe
    Object.values(room.players).forEach(p => {
      if (p.teamId === teamId) p.teamId = null;
    });
    delete room.teams[teamId];

    io.to(socket.roomCode).emit('teams-updated', { teams: room.teams });
    io.to(socket.roomCode).emit('players-updated', { players: room.players });
  });

  // Assigner un joueur à une équipe (null = sans équipe)
  socket.on('assign-team', ({ playerId, teamId }) => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;
    if (!room.players[playerId]) return;

    room.players[playerId].teamId = teamId;
    io.to(socket.roomCode).emit('players-updated', { players: room.players });
  });

  // Exclure un joueur
  socket.on('kick-player', ({ playerId }) => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;

    const targetSocket = io.sockets.sockets.get(playerId);
    if (targetSocket) {
      targetSocket.emit('kicked');
      targetSocket.leave(socket.roomCode);
    }

    if (room.players[playerId]) {
      const name = room.players[playerId].name;
      delete room.players[playerId];

      if (room.buzzedBy && room.buzzedBy.id === playerId) {
        room.status = 'playing';
        room.buzzedBy = null;
        io.to(socket.roomCode).emit('buzz-reset');
      }

      io.to(socket.roomCode).emit('player-left', {
        playerId,
        playerName: name,
        players: room.players,
      });
    }
  });

  // Mettre à jour le round
  socket.on('update-round', ({ round }) => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;
    room.round = round;
    io.to(socket.roomCode).emit('round-updated', { round });
  });

  // Sync YouTube : l'animateur envoie l'état du lecteur
  socket.on('youtube-sync', ({ action, videoId, currentTime, playlistId }) => {
    const room = rooms[socket.roomCode];
    if (!room || !socket.isHost) return;

    if (videoId || playlistId) {
      room.currentTrack = { videoId, playlistId, currentTime: currentTime || 0 };
    }

    socket.to(socket.roomCode).emit('youtube-sync', {
      action,
      videoId,
      playlistId,
      currentTime,
    });
  });

  // ─── JOUEUR ───────────────────────────────────────────────────

  socket.on('join-room', ({ code, name }, callback) => {
    const upperCode = code.toUpperCase().trim();
    const room = rooms[upperCode];

    if (!room) return callback({ success: false, error: 'Code de partie invalide' });
    if (room.status === 'finished') return callback({ success: false, error: 'La partie est terminée' });

    const nameTaken = Object.values(room.players).some(
      p => p.name.toLowerCase() === name.toLowerCase().trim()
    );
    if (nameTaken) return callback({ success: false, error: 'Ce pseudo est déjà pris' });

    const cleanName = name.trim().substring(0, 20);
    room.players[socket.id] = {
      id: socket.id,
      name: cleanName,
      score: 0,
      teamId: null,
    };

    socket.join(upperCode);
    socket.roomCode = upperCode;
    socket.isHost = false;
    socket.playerName = cleanName;

    io.to(upperCode).emit('player-joined', {
      player: room.players[socket.id],
      players: room.players,
    });

    callback({ success: true, room: getRoomState(room) });
    console.log(`${cleanName} a rejoint ${upperCode}`);
  });

  // Buzzer
  socket.on('buzz', () => {
    const room = rooms[socket.roomCode];
    if (!room || socket.isHost) return;
    if (room.status !== 'playing') return;
    if (room.buzzedBy) return;

    room.status = 'buzzed';
    room.buzzedBy = { id: socket.id, name: socket.playerName };

    io.to(socket.roomCode).emit('buzzed', { player: room.buzzedBy });
    // Pause automatique de la musique pour tout le monde
    io.to(socket.roomCode).emit('youtube-sync', { action: 'pause' });
    console.log(`BUZZ: ${socket.playerName} dans ${socket.roomCode}`);
  });

  // ─── DÉCONNEXION ──────────────────────────────────────────────

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];

    if (socket.isHost) {
      io.to(code).emit('host-disconnected');
      delete rooms[code];
      console.log(`Room ${code} fermée (hôte parti)`);
    } else if (room.players[socket.id]) {
      const playerName = room.players[socket.id].name;
      delete room.players[socket.id];

      if (room.buzzedBy && room.buzzedBy.id === socket.id) {
        room.status = 'playing';
        room.buzzedBy = null;
        io.to(code).emit('buzz-reset');
      }

      io.to(code).emit('player-left', {
        playerId: socket.id,
        playerName,
        players: room.players,
      });
      console.log(`${playerName} a quitté ${code}`);
    }
  });
});

// Nettoyage périodique des rooms inactives (> 4h)
setInterval(() => {
  const now = Date.now();
  Object.entries(rooms).forEach(([code, room]) => {
    if (room.createdAt && now - room.createdAt > 4 * 60 * 60 * 1000) {
      io.to(code).emit('host-disconnected');
      delete rooms[code];
      console.log(`Room ${code} supprimée (expirée)`);
    }
  });
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`BlindTest demarré sur le port ${PORT}`);
});
