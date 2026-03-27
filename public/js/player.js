'use strict';

const socket = io();

// ─── État local ───────────────────────────────────────────────
let myId     = null;
let myName   = null;
let roomCode = null;
let gameStatus = 'lobby';
let buzzedBy  = null;
let players  = {};
let teams    = {};
let ytPlayer  = null;
let ytReady   = false;

// ─── DOM ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const screenJoin   = $('screen-join');
const screenPlayer = $('screen-player');

// ─── Join ─────────────────────────────────────────────────────
$('btn-join').addEventListener('click', joinGame);
$('input-code').addEventListener('keydown', e => e.key === 'Enter' && $('input-name').focus());
$('input-name').addEventListener('keydown', e => e.key === 'Enter' && joinGame());
$('buzz-btn').addEventListener('click', doBuzz);
$('volume-slider').addEventListener('input', function () {
  const vol = parseInt(this.value, 10);
  if (ytPlayer && ytReady) ytPlayer.setVolume(vol);
  $('volume-icon').textContent = vol === 0 ? '🔇' : vol < 50 ? '🔉' : '🔊';
});

// Forcer majuscules sur le code
$('input-code').addEventListener('input', function() {
  this.value = this.value.toUpperCase();
});

// Pré-remplir le code depuis l'URL si présent (?code=ABC123)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('code')) {
  $('input-code').value = urlParams.get('code').toUpperCase();
  setTimeout(() => $('input-name').focus(), 100);
}

function joinGame() {
  const code = $('input-code').value.trim().toUpperCase();
  const name = $('input-name').value.trim();

  if (!code || code.length < 4) {
    showError('Entrez le code de la partie');
    return;
  }
  if (!name || name.length < 1) {
    showError('Entrez votre pseudo');
    return;
  }

  $('btn-join').disabled = true;
  $('btn-join').textContent = 'Connexion...';

  socket.emit('join-room', { code, name }, (res) => {
    if (!res.success) {
      showError(res.error || 'Impossible de rejoindre la partie');
      $('btn-join').disabled = false;
      $('btn-join').textContent = 'Rejoindre';
      return;
    }

    myId     = socket.id;
    myName   = name;
    roomCode = res.room.code;
    players  = res.room.players || {};
    teams    = res.room.teams || {};

    screenJoin.classList.add('hidden');
    screenPlayer.classList.remove('hidden');

    $('p-name-display').textContent = myName;
    $('p-room-display').textContent = `Partie ${roomCode}`;

    applyStatus(res.room.status, res.room.buzzedBy);
    renderMiniScores();
    updateMyScore();
    updateMyTeam();
  });
}

function showError(msg) {
  const el = $('join-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ─── Statuts ──────────────────────────────────────────────────
function applyStatus(s, bz) {
  gameStatus = s;
  buzzedBy   = bz || null;

  const lobbyMsg  = $('lobby-message');
  const buzzArea  = $('buzz-area');
  const buzzStatus = $('buzz-status');

  // Réinitialiser
  lobbyMsg.classList.add('hidden');
  buzzArea.classList.add('hidden');
  buzzStatus.classList.add('hidden');
  $('buzz-btn').disabled = false;

  if (s === 'lobby' || s === 'paused' || s === 'finished') {
    lobbyMsg.classList.remove('hidden');
    if (s === 'paused')   { $('lobby-message').querySelector('h2').textContent = 'Pause...'; }
    if (s === 'finished') { $('lobby-message').querySelector('h2').textContent = 'Partie terminée !'; }
    if (s === 'lobby')    { $('lobby-message').querySelector('h2').textContent = 'En attente de l\'animateur...'; }
    return;
  }

  if (s === 'playing') {
    buzzArea.classList.remove('hidden');
    $('buzz-btn').disabled = false;
    return;
  }

  if (s === 'buzzed') {
    buzzArea.classList.remove('hidden');
    $('buzz-btn').disabled = true;

    if (bz) {
      const isMe = bz.id === socket.id;
      showBuzzStatus(bz, isMe);
    }
  }
}

function showBuzzStatus(player, isMe) {
  const card  = $('buzz-status-card');
  const icon  = $('bsc-icon');
  const title = $('bsc-title');
  const name  = $('bsc-name');
  const overlay = $('buzz-status');

  if (isMe) {
    card.className = 'buzz-status-card my-buzz';
    icon.textContent  = '🎉';
    title.textContent = 'Tu as buzzé !';
    name.textContent  = '';
    flashBackground('green');
  } else {
    card.className = 'buzz-status-card other-buzz';
    icon.textContent  = '🔔';
    title.textContent = `${player.name} a buzzé !`;
    name.textContent  = 'Buzzer bloqué';
    flashBackground('red');
  }

  overlay.classList.remove('hidden');
}

function flashBackground(color) {
  const main = $('player-main');
  main.classList.remove('flash-green', 'flash-red');
  void main.offsetWidth; // reflow pour relancer l'animation
  main.classList.add(`flash-${color}`);
}

// ─── Son buzzer ───────────────────────────────────────────────
function playBuzzSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'square';
    osc.frequency.setValueAtTime(260, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.25);

    gain.gain.setValueAtTime(0.22, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close();
  } catch (_) {}
}

// ─── Buzz ─────────────────────────────────────────────────────
function doBuzz() {
  if (gameStatus !== 'playing') return;
  socket.emit('buzz');
  playBuzzSound();
  // Feedback haptique sur mobile
  if (navigator.vibrate) navigator.vibrate([50, 30, 80]);
}

// ─── Scores ───────────────────────────────────────────────────
function updateMyScore() {
  const me = players[socket.id];
  if (me) {
    $('p-score-display').textContent = `${me.score} pt${me.score !== 1 ? 's' : ''}`;
  }
}

function updateMyTeam() {
  const me = players[socket.id];
  const badge = $('p-team-badge');
  if (me && me.teamId && teams[me.teamId]) {
    const t = teams[me.teamId];
    badge.textContent = t.name;
    badge.style.background = t.color + '33';
    badge.style.color = t.color;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderMiniScores() {
  const container = $('player-scores-mini');
  const arr = Object.values(players).sort((a, b) => b.score - a.score);

  container.innerHTML = '';
  arr.forEach(p => {
    const isMe = p.id === socket.id;
    const div = document.createElement('div');
    div.className = 'psm-item' + (isMe ? ' me' : '');
    div.innerHTML = `
      <div class="psm-name">${escHtml(p.name)}</div>
      <div class="psm-score">${p.score}</div>
    `;
    container.appendChild(div);
  });
}

// ─── YouTube (sync depuis l'animateur) ────────────────────────
window.onYouTubeIframeAPIReady = function () {
  ytReady = true;
};

function initYtPlayer(videoId, playlistId, currentTime) {
  const playerVars = { controls: 0, rel: 0, modestbranding: 1 };
  if (playlistId) {
    playerVars.listType = 'playlist';
    playerVars.list = playlistId;
  }

  if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
    if (videoId) ytPlayer.loadVideoById(videoId, currentTime || 0);
    else if (playlistId) ytPlayer.loadPlaylist({ listType: 'playlist', list: playlistId, startSeconds: currentTime || 0 });
    return;
  }

  ytPlayer = new YT.Player('yt-player-p', {
    height: '100%', width: '100%',
    videoId: videoId || '',
    playerVars,
    events: {
      onReady: () => {
        ytReady = true;
        ytPlayer.setVolume(parseInt($('volume-slider').value, 10));
      },
    },
  });
}

// ─── Socket events ────────────────────────────────────────────
socket.on('status-changed', ({ status, buzzedBy: bz }) => {
  applyStatus(status, bz);
});

socket.on('buzzed', ({ player }) => {
  applyStatus('buzzed', player);
});

socket.on('buzz-reset', () => {
  applyStatus('playing', null);
});

socket.on('player-joined', ({ players: p }) => {
  players = p;
  renderMiniScores();
  updateMyScore();
});

socket.on('player-left', ({ players: p }) => {
  players = p;
  renderMiniScores();
  updateMyScore();
});

socket.on('scores-updated', ({ players: p, teams: t }) => {
  players = p;
  teams   = t;
  renderMiniScores();
  updateMyScore();
  updateMyTeam();
});

socket.on('teams-updated', ({ teams: t }) => {
  teams = t;
  updateMyTeam();
});

socket.on('players-updated', ({ players: p }) => {
  players = p;
  renderMiniScores();
  updateMyScore();
  updateMyTeam();
});

socket.on('round-updated', ({ round }) => {
  toast(`Manche ${round}`, 'info');
});

socket.on('youtube-sync', ({ action, videoId, playlistId, currentTime }) => {
  $('volume-control').classList.remove('hidden');

  if (action === 'load') {
    initYtPlayer(videoId, playlistId, currentTime);
    return;
  }

  if (!ytPlayer || !ytReady) return;

  if (action === 'play')  { ytPlayer.seekTo(currentTime, true); ytPlayer.playVideo(); }
  if (action === 'pause') { ytPlayer.seekTo(currentTime, true); ytPlayer.pauseVideo(); }
  if (action === 'next')  { ytPlayer.nextVideo(); }
  if (action === 'prev')  { ytPlayer.previousVideo(); }
});

socket.on('answer-result', ({ correct, playerName, playerId }) => {
  const isMe = playerId === socket.id;
  if (correct) {
    if (isMe) {
      toast('Bonne réponse ! +1 pt 🎉', 'success');
      flashBackground('green');
    } else {
      toast(`${playerName} a trouvé la réponse !`, 'info');
    }
  } else {
    if (isMe) {
      toast('Mauvaise réponse...', 'error');
      flashBackground('red');
    } else {
      toast(`Mauvaise réponse de ${playerName}`, 'info');
    }
  }
});

socket.on('kicked', () => {
  alert('Vous avez été exclu de la partie.');
  window.location.href = '/';
});

socket.on('host-disconnected', () => {
  toast('L\'animateur a quitté la partie', 'error');
  setTimeout(() => {
    screenPlayer.classList.add('hidden');
    screenJoin.classList.remove('hidden');
  }, 3000);
});

socket.on('disconnect', () => {
  toast('Connexion perdue, tentative de reconnexion...', 'error');
});

socket.on('connect', () => {
  // Si on était déjà en partie, tenter de se reconnecter
  if (roomCode && myName) {
    socket.emit('join-room', { code: roomCode, name: myName }, (res) => {
      if (res.success) {
        players = res.room.players || {};
        teams   = res.room.teams || {};
        applyStatus(res.room.status, res.room.buzzedBy);
        renderMiniScores();
        updateMyScore();
        toast('Reconnecté !', 'success');
      }
    });
  }
});

// ─── Utils ────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const container = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
