'use strict';

const socket = io();

// ─── État local ───────────────────────────────────────────────
let roomCode = null;
let players = {};
let teams = {};
let status = 'lobby';
let buzzedBy = null;
let round = 1;
let ytPlayer = null;
let ytReady = false;
let ytMuted = false;
let currentVideoId = null;
let currentPlaylistId = null;
let selectedColor = '#7c6aff';
let pointsPerBuzz = 1;
let keepAliveInterval = null;

const TEAM_COLORS = [
  '#7c6aff', '#ff6b8a', '#2ecc71', '#f1c40f',
  '#e67e22', '#1abc9c', '#e74c3c', '#3498db',
  '#9b59b6', '#fd79a8',
];

// ─── DOM ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const screenCreate = $('screen-create');
const screenHost   = $('screen-host');

// ─── Init ─────────────────────────────────────────────────────
$('btn-create').addEventListener('click', createRoom);
$('btn-toggle-status').addEventListener('click', toggleStatus);
$('btn-reset-buzz').addEventListener('click', resetBuzz);
$('btn-good-answer').addEventListener('click', () => handleAnswer(true));
$('btn-wrong-answer').addEventListener('click', () => handleAnswer(false));
$('btn-manual-score').addEventListener('click', openManualScore);
$('btn-round-dec').addEventListener('click', () => updateRound(round - 1));
$('btn-round-inc').addEventListener('click', () => updateRound(round + 1));
$('btn-add-team').addEventListener('click', openTeamModal);
$('btn-yt-load').addEventListener('click', loadYoutube);
$('btn-yt-play').addEventListener('click', ytPlay);
$('btn-yt-pause').addEventListener('click', ytPause);
$('btn-yt-mute').addEventListener('click', ytToggleMute);
$('btn-yt-next').addEventListener('click', ytNext);
$('btn-yt-prev').addEventListener('click', ytPrev);
$('btn-confirm-team').addEventListener('click', confirmCreateTeam);
$('yt-url-input').addEventListener('keydown', e => e.key === 'Enter' && loadYoutube());

// ─── Couleurs équipe ──────────────────────────────────────────
function buildColorPicker() {
  const container = $('color-picker');
  container.innerHTML = '';
  TEAM_COLORS.forEach(color => {
    const d = document.createElement('div');
    d.className = 'color-option' + (color === selectedColor ? ' selected' : '');
    d.style.background = color;
    d.onclick = () => {
      selectedColor = color;
      container.querySelectorAll('.color-option').forEach(el => el.classList.remove('selected'));
      d.classList.add('selected');
    };
    container.appendChild(d);
  });
}

// ─── Créer la partie ──────────────────────────────────────────
function createRoom() {
  $('btn-create').disabled = true;
  $('btn-create').textContent = 'Création...';

  socket.emit('create-room', (res) => {
    if (!res.success) {
      showError('create-error', 'Erreur lors de la création. Réessayez.');
      $('btn-create').disabled = false;
      $('btn-create').textContent = 'Créer la partie';
      return;
    }
    roomCode = res.code;
    $('header-code').textContent = roomCode;
    screenCreate.classList.add('hidden');
    screenHost.classList.remove('hidden');
    toast(`Partie créée ! Code : ${roomCode}`, 'success');
    keepAliveInterval = setInterval(() => fetch('/ping').catch(() => {}), 5 * 60 * 1000);
  });
}

function copyCode() {
  navigator.clipboard.writeText(roomCode).then(() => toast('Code copié !', 'success'));
}

// ─── Statut ───────────────────────────────────────────────────
function toggleStatus() {
  const newStatus = status === 'lobby' || status === 'paused' ? 'playing' : 'paused';
  socket.emit('set-status', { status: newStatus });
}

function setStatusUI(s) {
  status = s;
  const pill = $('header-status');
  const text = $('status-text');
  const btn  = $('btn-toggle-status');

  pill.className = `status-pill ${s}`;
  if (s === 'lobby')   { text.textContent = 'Lobby';      btn.textContent = '▶ Démarrer'; }
  if (s === 'playing') { text.textContent = 'En jeu';     btn.textContent = '⏸ Pause'; }
  if (s === 'paused')  { text.textContent = 'En pause';   btn.textContent = '▶ Reprendre'; }
  if (s === 'buzzed')  { text.textContent = 'Buzzé !';    btn.textContent = '⏸ Pause'; }
  if (s === 'finished'){ text.textContent = 'Terminée'; }
}

function endGame() {
  if (!confirm('Terminer la partie ?')) return;
  socket.emit('set-status', { status: 'finished' });
  toast('Partie terminée', 'info');
}

// ─── Buzz ─────────────────────────────────────────────────────
function setBuzzUI(player) {
  buzzedBy = player;
  const ind = $('buzz-indicator');

  if (player) {
    ind.textContent = `🔔 ${player.name} a buzzé !`;
    ind.classList.add('active');
    $('btn-reset-buzz').disabled = false;
    $('btn-good-answer').disabled = false;
    $('btn-wrong-answer').disabled = false;
  } else {
    ind.textContent = 'En attente...';
    ind.classList.remove('active');
    $('btn-reset-buzz').disabled = true;
    $('btn-good-answer').disabled = true;
    $('btn-wrong-answer').disabled = true;
  }
}

function resetBuzz() {
  socket.emit('reset-buzz');
}

function handleAnswer(correct) {
  if (!buzzedBy) return;

  socket.emit('answer-result', { correct, playerId: buzzedBy.id });

  if (correct) {
    socket.emit('update-score', { playerId: buzzedBy.id, delta: pointsPerBuzz });
    toast(`+${pointsPerBuzz} pt pour ${buzzedBy.name}`, 'success');
  } else {
    toast(`Mauvaise réponse de ${buzzedBy.name}`, 'error');
  }
  socket.emit('reset-buzz');
}

// ─── Round ────────────────────────────────────────────────────
function updateRound(n) {
  if (n < 1) return;
  socket.emit('update-round', { round: n });
}

// ─── Joueurs ──────────────────────────────────────────────────
function renderPlayers() {
  const list = $('players-list');
  const arr = Object.values(players);
  $('player-count').textContent = arr.length;

  if (arr.length === 0) {
    list.innerHTML = '<div class="empty-state">En attente de joueurs...</div>';
    return;
  }

  list.innerHTML = '';
  arr.forEach(p => {
    const team = p.teamId && teams[p.teamId] ? teams[p.teamId] : null;
    const avatar = p.name.charAt(0).toUpperCase();
    const color = team ? team.color : '#7c6aff';

    const div = document.createElement('div');
    div.className = 'player-item';
    div.innerHTML = `
      <div class="player-avatar" style="background:${color}22; color:${color};">${avatar}</div>
      <div class="player-name">
        ${escHtml(p.name)}
        ${team ? `<span class="team-badge" style="background:${team.color}22; color:${team.color}; margin-left:.4rem">${escHtml(team.name)}</span>` : ''}
      </div>
      <div class="player-score">${p.score}</div>
      <div class="score-btns">
        <button class="btn btn-ghost btn-icon btn-sm" onclick="quickScore('${p.id}', 1)" title="+1">+</button>
        <button class="btn btn-ghost btn-icon btn-sm" onclick="quickScore('${p.id}', -1)" title="-1">−</button>
      </div>
      <button class="btn btn-danger btn-icon btn-sm" onclick="kickPlayer('${p.id}')" title="Exclure">✕</button>
    `;
    list.appendChild(div);
  });
}

function quickScore(playerId, delta) {
  socket.emit('update-score', { playerId, delta });
}

function kickPlayer(playerId) {
  const p = players[playerId];
  if (!p) return;
  if (!confirm(`Exclure ${p.name} ?`)) return;
  socket.emit('kick-player', { playerId });
}

// ─── Scoreboard ───────────────────────────────────────────────
function renderScoreboard() {
  const container = $('scoreboard');
  const arr = Object.values(players).sort((a, b) => b.score - a.score);

  if (arr.length === 0) {
    container.innerHTML = '<div class="empty-state">Aucun joueur</div>';
    return;
  }

  container.innerHTML = '';
  arr.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'score-row';
    const rankClass = i < 3 ? `rank-${i+1}` : '';
    const medals = ['🥇', '🥈', '🥉'];
    const rankDisplay = i < 3 ? medals[i] : `${i+1}`;
    div.innerHTML = `
      <div class="score-rank ${rankClass}">${rankDisplay}</div>
      <div class="score-name">${escHtml(p.name)}</div>
      <div class="score-pts">${p.score} pt${p.score !== 1 ? 's' : ''}</div>
    `;
    container.appendChild(div);
  });
}

// ─── Équipes ──────────────────────────────────────────────────
function renderTeams() {
  const list = $('teams-list');
  const arr = Object.values(teams);

  if (arr.length === 0) {
    list.innerHTML = '<div class="empty-state">Aucune équipe</div>';
  } else {
    list.innerHTML = '';
    arr.forEach(t => {
      const members = Object.values(players).filter(p => p.teamId === t.id);
      const div = document.createElement('div');
      div.className = 'team-item';
      div.innerHTML = `
        <div class="team-color-dot" style="background:${t.color}"></div>
        <div style="flex:1">
          <div class="team-name-text">${escHtml(t.name)}</div>
          <div class="text-muted" style="font-size:.78rem">${members.length} joueur${members.length !== 1 ? 's' : ''}</div>
        </div>
        <div style="display:flex; align-items:center; gap:.4rem;">
          <button class="btn btn-ghost btn-icon btn-sm" onclick="teamScore('${t.id}', 1)">+</button>
          <span class="team-score-val">${t.score}</span>
          <button class="btn btn-ghost btn-icon btn-sm" onclick="teamScore('${t.id}', -1)">−</button>
        </div>
        <button class="btn btn-danger btn-icon btn-sm" onclick="deleteTeam('${t.id}')" title="Supprimer">✕</button>
      `;
      list.appendChild(div);
    });
  }

  renderAssign();
}

function teamScore(teamId, delta) {
  socket.emit('update-team-score', { teamId, delta });
}

function deleteTeam(teamId) {
  const t = teams[teamId];
  if (!t || !confirm(`Supprimer l'équipe "${t.name}" ?`)) return;
  socket.emit('delete-team', { teamId });
}

function renderAssign() {
  const list = $('assign-list');
  const arr = Object.values(players);

  if (arr.length === 0) {
    list.innerHTML = '<div class="empty-state">Aucun joueur</div>';
    return;
  }

  list.innerHTML = '';
  arr.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-item';

    const selectOpts = `<option value="">Sans équipe</option>` +
      Object.values(teams).map(t =>
        `<option value="${t.id}" ${p.teamId === t.id ? 'selected' : ''}>${escHtml(t.name)}</option>`
      ).join('');

    div.innerHTML = `
      <div class="player-name" style="flex:1">${escHtml(p.name)}</div>
      <select style="width:auto; font-size:.8rem; padding:.3rem .5rem" onchange="assignTeam('${p.id}', this.value)">
        ${selectOpts}
      </select>
    `;
    list.appendChild(div);
  });
}

function assignTeam(playerId, teamId) {
  socket.emit('assign-team', { playerId, teamId: teamId || null });
}

// ─── Modal équipe ─────────────────────────────────────────────
function openTeamModal() {
  selectedColor = TEAM_COLORS[Object.keys(teams).length % TEAM_COLORS.length];
  buildColorPicker();
  $('team-name-input').value = '';
  $('modal-team').classList.remove('hidden');
  setTimeout(() => $('team-name-input').focus(), 50);
}

function confirmCreateTeam() {
  const name = $('team-name-input').value.trim();
  if (!name) { $('team-name-input').focus(); return; }
  socket.emit('create-team', { name, color: selectedColor });
  closeModal('modal-team');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal('modal-team');
    closeModal('modal-score');
  }
  if (e.key === 'Enter' && !$('modal-team').classList.contains('hidden')) {
    confirmCreateTeam();
  }
});

// ─── Modal points manuels ─────────────────────────────────────
function openManualScore() {
  const list = $('modal-score-list');
  const arr = Object.values(players).sort((a, b) => b.score - a.score);

  if (arr.length === 0) {
    list.innerHTML = '<div class="empty-state">Aucun joueur</div>';
  } else {
    list.innerHTML = '';
    arr.forEach(p => {
      const div = document.createElement('div');
      div.className = 'player-item';
      div.style.marginBottom = '.4rem';
      div.innerHTML = `
        <div class="player-name" style="flex:1">${escHtml(p.name)}</div>
        <div style="display:flex; align-items:center; gap:.4rem;">
          <button class="btn btn-danger btn-sm" onclick="manualDelta('${p.id}', -1)">−1</button>
          <button class="btn btn-danger btn-sm" onclick="manualDelta('${p.id}', -5)">−5</button>
          <span class="player-score" id="ms-score-${p.id}">${p.score}</span>
          <button class="btn btn-success btn-sm" onclick="manualDelta('${p.id}', 1)">+1</button>
          <button class="btn btn-success btn-sm" onclick="manualDelta('${p.id}', 5)">+5</button>
        </div>
      `;
      list.appendChild(div);
    });
  }

  $('modal-score').classList.remove('hidden');
}

function manualDelta(playerId, delta) {
  socket.emit('update-score', { playerId, delta });
  // Mise à jour optimiste de l'affichage dans la modal
  const el = document.getElementById(`ms-score-${playerId}`);
  if (el && players[playerId]) {
    el.textContent = Math.max(0, players[playerId].score + delta);
  }
}

function closeModal(id) {
  $(id).classList.add('hidden');
}

// ─── YouTube ──────────────────────────────────────────────────
window.onYouTubeIframeAPIReady = function () {
  ytReady = true;
};

function parseYouTubeUrl(url) {
  const patterns = [
    /[?&]v=([^&#]+)/,
    /youtu\.be\/([^?&#]+)/,
    /youtube\.com\/embed\/([^?&#]+)/,
    /youtube\.com\/shorts\/([^?&#]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return { videoId: m[1], playlistId: null };
  }
  const plMatch = url.match(/[?&]list=([^&#]+)/);
  if (plMatch) return { videoId: null, playlistId: plMatch[1] };
  return null;
}

function loadYoutube() {
  const url = $('yt-url-input').value.trim();
  if (!url) return;

  const parsed = parseYouTubeUrl(url);
  if (!parsed) {
    toast('URL YouTube invalide', 'error');
    return;
  }

  $('yt-placeholder').classList.add('hidden');
  $('yt-wrapper').classList.remove('hidden');

  if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
    if (parsed.videoId) {
      ytPlayer.loadVideoById(parsed.videoId);
    } else if (parsed.playlistId) {
      ytPlayer.loadPlaylist({ listType: 'playlist', list: parsed.playlistId });
    }
  } else {
    const playerVars = {
      controls: 1,
      rel: 0,
      modestbranding: 1,
    };
    if (parsed.playlistId) {
      playerVars.listType = 'playlist';
      playerVars.list = parsed.playlistId;
    }

    ytPlayer = new YT.Player('yt-player', {
      height: '100%', width: '100%',
      videoId: parsed.videoId || '',
      playerVars,
      events: {
        onReady: () => {
          ytReady = true;
          toast('Lecteur prêt', 'success');
        },
        onStateChange: (e) => {
          // Sync automatique si l'animateur interagit directement dans le player
          if (e.data === YT.PlayerState.PLAYING && $('yt-sync-toggle').checked) {
            syncYt('play');
          }
          if (e.data === YT.PlayerState.PAUSED && $('yt-sync-toggle').checked) {
            syncYt('pause');
          }
        },
      },
    });
  }

  currentVideoId = parsed.videoId;
  currentPlaylistId = parsed.playlistId;

  if ($('yt-sync-toggle').checked) {
    socket.emit('youtube-sync', {
      action: 'load',
      videoId: parsed.videoId,
      playlistId: parsed.playlistId,
      currentTime: 0,
    });
  }
}

function ytPlay() {
  if (!ytPlayer) return;
  ytPlayer.playVideo();
  if ($('yt-sync-toggle').checked) syncYt('play');
}

function ytPause() {
  if (!ytPlayer) return;
  ytPlayer.pauseVideo();
  if ($('yt-sync-toggle').checked) syncYt('pause');
}

function ytNext() {
  if (!ytPlayer) return;
  ytPlayer.nextVideo();
  if ($('yt-sync-toggle').checked) syncYt('next');
}

function ytPrev() {
  if (!ytPlayer) return;
  ytPlayer.previousVideo();
  if ($('yt-sync-toggle').checked) syncYt('prev');
}

function ytToggleMute() {
  if (!ytPlayer) return;
  ytMuted = !ytMuted;
  ytMuted ? ytPlayer.mute() : ytPlayer.unMute();
  $('btn-yt-mute').textContent = ytMuted ? '🔊 Son' : '🔇 Mute';
}

function syncYt(action) {
  const ct = ytPlayer ? ytPlayer.getCurrentTime() : 0;
  socket.emit('youtube-sync', { action, currentTime: ct });
}

// ─── Socket events ────────────────────────────────────────────
socket.on('player-joined', ({ players: p }) => {
  players = p;
  renderPlayers();
  renderScoreboard();
  renderAssign();
  toast(`Un joueur a rejoint la partie`, 'info');
});

socket.on('sync-new-player', ({ socketId }) => {
  if (!ytPlayer || !ytReady) return;
  const ct = ytPlayer.getCurrentTime() || 0;
  socket.emit('youtube-sync-direct', {
    socketId,
    action: 'load',
    videoId: currentVideoId,
    playlistId: currentPlaylistId,
    currentTime: ct,
  });
});

socket.on('player-left', ({ playerName, players: p }) => {
  players = p;
  renderPlayers();
  renderScoreboard();
  renderAssign();
  toast(`${playerName} a quitté la partie`, 'info');
});

socket.on('buzzed', ({ player }) => {
  setBuzzUI(player);
  setStatusUI('buzzed');
  if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
    ytPlayer.pauseVideo();
  }
});

socket.on('buzz-reset', () => {
  setBuzzUI(null);
  setStatusUI(status === 'buzzed' ? 'playing' : status);
});

socket.on('status-changed', ({ status: s, buzzedBy: bz }) => {
  setStatusUI(s);
  if (s !== 'buzzed') setBuzzUI(null);
});

socket.on('scores-updated', ({ players: p, teams: t }) => {
  players = p;
  teams = t;
  renderPlayers();
  renderScoreboard();
  renderTeams();
});

socket.on('teams-updated', ({ teams: t }) => {
  teams = t;
  renderTeams();
});

socket.on('players-updated', ({ players: p }) => {
  players = p;
  renderPlayers();
  renderAssign();
});

socket.on('round-updated', ({ round: r }) => {
  round = r;
  $('round-val').textContent = r;
});

// ─── Toast & utils ────────────────────────────────────────────
function toast(msg, type = 'info') {
  const container = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function showError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
