/* ============================================================
   Multiplayer Texas Hold'em — WebRTC room-based (PeerJS)
   ============================================================ */

// ==================== CONSTANTS ====================
const SUITS = [
  { key: 'S', label: '♠', red: false },
  { key: 'H', label: '♥', red: true },
  { key: 'D', label: '♦', red: true },
  { key: 'C', label: '♣', red: false },
];
const RANKS = [
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '4', value: 4 },
  { label: '5', value: 5 },
  { label: '6', value: 6 },
  { label: '7', value: 7 },
  { label: '8', value: 8 },
  { label: '9', value: 9 },
  { label: '10', value: 10 },
  { label: 'J', value: 11 },
  { label: 'Q', value: 12 },
  { label: 'K', value: 13 },
  { label: 'A', value: 14 },
];
const HAND_NAMES = [
  '高牌',           // 高牌
  '一对',           // 一对
  '两对',           // 两对
  '三条',           // 三条
  '顺子',           // 顺子
  '同花',           // 同花
  '葫芦',           // 葫芦
  '四条',           // 四条
  '同花顺',     // 同花顺
];
const PHASE_NAMES = {
  lobby: '等待中',
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
};

const BB = 20;
const SB = 10;
const MAX_PLAYERS = 8;
const TURN_TIMEOUT_MS = 60000;
const AUTO_NEXT_HAND_DELAY = 5000;

/* Visual seat positions on the oval table.
   Index 4 is always the local player (bottom-center).
   Other indices wrap around clockwise. */
const SEAT_POSITIONS = [
  { cls: 'sp-tl' },  // 0  top-left
  { cls: 'sp-tc' },  // 1  top-center
  { cls: 'sp-tr' },  // 2  top-right
  { cls: 'sp-r' },   // 3  right
  { cls: 'sp-bc' },  // 4  bottom-center (local)
  { cls: 'sp-br' },  // 5  bottom-right
  { cls: 'sp-bl' },  // 6  bottom-left
  { cls: 'sp-l' },   // 7  left
];

// ==================== DOM REFS ====================
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const DOM = {
  lobby:        $('#lobby'),
  gameUI:       $('#gameUI'),
  nameInputC:   $('#nameInputCreate'),
  nameInputJ:   $('#nameInputJoin'),
  roomIdInput:  $('#roomIdInput'),
  createBtn:    $('#createRoomBtn'),
  joinBtn:      $('#joinRoomBtn'),
  lobbyTabs:    $$('.tab'),
  createPanel:  $('#createPanel'),
  joinPanel:    $('#joinPanel'),
  roomDisplay:  $('#roomIdDisplay'),
  copyBtn:      $('#copyRoomBtn'),
  connStatus:   $('#connectionStatus'),
  handNumber:   $('#handNumber'),
  potValue:     $('#potValue'),
  centerPot:    $('#centerPot'),
  phaseName:    $('#phaseName'),
  community:    $('#communityCards'),
  message:      $('#message'),
  handInfo:     $('#handInfo'),
  actionTimer:  $('#actionTimer'),
  eventLog:     $('#eventLog'),
  table:        $('#pokerTable'),
  startBtn:     $('#startBtn'),
  foldBtn:      $('#foldBtn'),
  checkBtn:     $('#checkBtn'),
  callBtn:      $('#callBtn'),
  raiseBtn:     $('#raiseBtn'),
  raiseAmount:  $('#raiseAmount'),
  raiseSlider:  $('#raiseSlider'),
  raiseArea:    $('#raiseArea'),
  allInBtn:     $('#allInBtn'),
  nextHandBtn:  $('#nextHandBtn'),
  actionPanel:  $('#actionPanel'),
};

// ==================== GAME STATE ====================
const G = {
  phase: 'lobby',
  players: [],
  communityCards: [],
  pot: 0,
  handNumber: 0,
  dealerPos: 0,
  currentTurn: -1,
  deck: [],
  /* host-only */
  lastRaiseSize: 0,
  waitingForAction: false,
  bigBlindId: -1,
  bbActedThisRound: false,
  /* networking */
  mySeatId: -1,
  isHost: false,
  roomId: '',
  connected: false,
  peer: null,
  hostConn: null,         // non-host: connection to host
  peerConns: [],          // host: array of connections keyed by seatId
  turnTimer: null,        // UI countdown interval for current turn
  autoFoldTimer: null,    // setTimeout for auto-fold if player doesn't act
  autoNextHandTimer: null, // setTimeout for auto-advancing to next hand
  showdownHands: [],      // hands revealed at showdown
};

// ==================== CARD UTILITIES ====================
function createDeck() {
  const deck = [];
  for (const s of SUITS)
    for (const r of RANKS)
      deck.push({ suit: s.key, suitLabel: s.label, red: s.red, rank: r.label, value: r.value });
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function draw() { return G.deck.pop(); }

function rankLabel(v) { const r = RANKS.find((x) => x.value === v); return r ? r.label : String(v); }

function combinations(items, size) {
  const out = [];
  function pick(start, combo) {
    if (combo.length === size) { out.push(combo); return; }
    for (let i = start; i <= items.length - (size - combo.length); i++)
      pick(i + 1, [...combo, items[i]]);
  }
  pick(0, []);
  return out;
}

// ==================== HAND EVALUATION ====================
function evaluateBest(cards) {
  return combinations(cards, 5).map(evalFive).sort((a, b) => cmpVal(b, a))[0];
}

function evalFive(cards) {
  const vs = cards.map((c) => c.value).sort((a, b) => b - a);
  const counts = {};
  vs.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
  const groups = Object.entries(counts)
    .map(([v, c]) => ({ value: +v, count: c }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const straightHigh = getStraightHigh(vs);

  if (flush && straightHigh) return { rank: 8, kickers: [straightHigh] };
  if (groups[0].count === 4) return { rank: 7, kickers: [groups[0].value, ...vs.filter(v => v !== groups[0].value)] };
  if (groups[0].count === 3 && groups[1].count === 2) return { rank: 6, kickers: [groups[0].value, groups[1].value] };
  if (flush) return { rank: 5, kickers: vs };
  if (straightHigh) return { rank: 4, kickers: [straightHigh] };
  if (groups[0].count === 3) return { rank: 3, kickers: [groups[0].value, ...vs.filter(v => v !== groups[0].value)] };
  if (groups[0].count === 2 && groups[1] && groups[1].count === 2) {
    const pv = groups.filter(g => g.count === 2).map(g => g.value).sort((a, b) => b - a);
    const lone = vs.find(v => !pv.includes(v));
    return { rank: 2, kickers: [...pv, lone] };
  }
  if (groups[0].count === 2) return { rank: 1, kickers: [groups[0].value, ...vs.filter(v => v !== groups[0].value)] };
  return { rank: 0, kickers: vs };
}

function getStraightHigh(values) {
  const uniq = [...new Set(values)].sort((a, b) => b - a);
  if (uniq[0] === 14) uniq.push(1);
  for (let i = 0; i <= uniq.length - 5; i++)
    if (uniq[i] - uniq[i + 4] === 4) return uniq[i];
  return 0;
}

function cmpVal(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i++)
    if ((a.kickers[i] || 0) !== (b.kickers[i] || 0)) return (a.kickers[i] || 0) - (b.kickers[i] || 0);
  return 0;
}

function describeValue(v) {
  return HAND_NAMES[v.rank] + ' ' + v.kickers.map(rankLabel).join(' ');
}

// ==================== UI — TOGGLE PANELS ====================
function showLobby() {
  DOM.lobby.classList.remove('hidden');
  DOM.gameUI.classList.add('hidden');
}

function showGame() {
  DOM.lobby.classList.add('hidden');
  DOM.gameUI.classList.remove('hidden');
}

// ==================== UI — RENDER ====================
function render() {
  const p = G.players;

  /* Hero stats */
  DOM.handNumber.textContent = G.handNumber;
  DOM.potValue.textContent = G.pot;
  DOM.centerPot.textContent = G.pot;
  DOM.phaseName.textContent = PHASE_NAMES[G.phase] || '准备';

  /* Community cards */
  DOM.community.innerHTML = G.communityCards.map(cardHTML).join('');

  /* Seats — build seat elements */
  const localIdx = G.mySeatId;

  /* Remove old dynamic seats */
  DOM.table.querySelectorAll('.seat-dynamic').forEach((el) => el.remove());

  for (let i = 0; i < MAX_PLAYERS; i++) {
    const visualIdx = (i - localIdx + 4 + MAX_PLAYERS) % MAX_PLAYERS;
    const pos = SEAT_POSITIONS[visualIdx];
    const seat = document.createElement('div');
    seat.className = 'seat seat-dynamic ' + pos.cls;
    seat.dataset.seatIdx = i;

    const pl = p.find((x) => x.id === i);
    if (pl) {
      const isMe = i === localIdx;
      const isDealer = G.handNumber > 0 && i === G.dealerPos;
      const isTurn = G.currentTurn === i;
      const folded = pl.folded;
      const allIn = pl.allIn;
      const disconnected = !pl.connected;

      /* Hand cards: mine -> always visible; showdown -> all visible; others hidden */
      let showCards = false;
      let holeCards = [];
      if (isMe && pl.holeCards && pl.holeCards.length) {
        showCards = true;
        holeCards = pl.holeCards;
      } else if (G.phase === 'showdown' && pl.holeCards && pl.holeCards.length) {
        showCards = true;
        holeCards = pl.holeCards;
      }

      seat.innerHTML = `
        <div class="seat-inner ${folded ? 'folded' : ''} ${isTurn ? 'turn-active' : ''} ${disconnected ? 'disconnected' : ''}">
          <div class="seat-header">
            <span class="seat-name">${disconnected ? pl.name + ' (已断线)' : pl.name}</span>
            <span class="seat-badge ${isMe ? 'badge-you' : ''}">${folded ? '已弃牌' : allIn ? 'ALL-IN' : pl.chips}</span>
          </div>
          ${isDealer ? '<span class="dealer-chip">D</span>' : ''}
          <div class="cards mini-cards">
            ${showCards ? holeCards.map(cardHTML).join('') : (G.phase !== 'lobby' && !folded ? '<div class="card back"><div class="rank">&#9670;</div><div class="suit">&#9839;</div></div><div class="card back"><div class="rank">&#9670;</div><div class="suit">&#9839;</div></div>' : '')}
          </div>
          ${pl.bet > 0 ? `<div class="bet-chip">${pl.bet}</div>` : ''}
          ${isTurn ? '<div class="turn-arrow">&#9650;</div>' : ''}
        </div>
      `;

      if (isMe) seat.classList.add('my-seat');
      if (isTurn) seat.classList.add('turn-seat');
    } else {
      seat.innerHTML = `<div class="seat-inner empty-seat"><span class="empty-label">${i === localIdx ? '你的座位' : '空座'}</span></div>`;
    }

    DOM.table.appendChild(seat);
  }

  /* Hand info for local player */
  if (G.phase !== 'lobby') {
    const me = p.find((x) => x.id === localIdx);
    if (me && !me.folded && me.holeCards && me.holeCards.length >= 2 && G.communityCards.length >= 3) {
      const all = [...me.holeCards, ...G.communityCards];
      DOM.handInfo.textContent = '当前牌型：' + describeValue(evaluateBest(all));
    } else if (me && me.folded) {
      DOM.handInfo.textContent = '你已弃牌';
    } else {
      DOM.handInfo.textContent = '等待发牌…';
    }
  } else {
    DOM.handInfo.textContent = '等待发牌';
  }
}

function cardHTML(card) {
  return `<div class="card${card.red ? ' red' : ''}" aria-label="${card.rank}${card.suitLabel}"><div class="rank">${card.rank}</div><div class="suit">${card.suitLabel}</div></div>`;
}

// ==================== UI — ACTION BUTTONS ====================
function showActions(list) {
  hideActions();
  list.forEach((a) => {
    if (a === 'fold') DOM.foldBtn.classList.remove('hidden');
    if (a === 'check') DOM.checkBtn.classList.remove('hidden');
    if (a === 'call') DOM.callBtn.classList.remove('hidden');
    if (a === 'raise') DOM.raiseArea.classList.remove('hidden');
    if (a === 'allin') DOM.allInBtn.classList.remove('hidden');
  });
}

function hideActions() {
  DOM.foldBtn.classList.add('hidden');
  DOM.checkBtn.classList.add('hidden');
  DOM.callBtn.classList.add('hidden');
  DOM.raiseArea.classList.add('hidden');
  DOM.allInBtn.classList.add('hidden');
}

// ==================== UI — LOG & MESSAGE ====================
function log(text, reset) {
  if (reset) DOM.eventLog.innerHTML = '';
  const li = document.createElement('li');
  li.textContent = text;
  DOM.eventLog.prepend(li);
  while (DOM.eventLog.children.length > 12) DOM.eventLog.lastElementChild.remove();
}

function setMessage(text) {
  DOM.message.textContent = text;
  const lm = document.getElementById('lobbyMessage');
  if (lm) lm.textContent = text;
}

function setStatus(connected) {
  G.connected = connected;
  DOM.connStatus.className = 'status-dot ' + (connected ? 'connected' : 'disconnected');
}

// ==================== UI — TIMER ====================
function startTurnTimer(seconds) {
  clearTurnTimers();
  let remaining = seconds;
  DOM.actionTimer.textContent = remaining + 's';
  G.turnTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      DOM.actionTimer.textContent = '';
      clearInterval(G.turnTimer);
      G.turnTimer = null;
    } else {
      DOM.actionTimer.textContent = remaining + 's';
    }
  }, 1000);
}

function clearTurnTimers() {
  if (G.turnTimer) { clearInterval(G.turnTimer); G.turnTimer = null; }
  if (G.autoFoldTimer) { clearTimeout(G.autoFoldTimer); G.autoFoldTimer = null; }
  DOM.actionTimer.textContent = '';
}

// ==================== NETWORKING — PEERJS UTILS ====================
function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function getJoinUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('room', G.roomId);
  return url.toString();
}

// ==================== NETWORKING — HOST ====================
function hostCreateRoom(name) {
  const roomId = generateRoomId();
  G.roomId = roomId;
  G.isHost = true;

  if (typeof Peer === 'undefined') {
    setMessage('加载 PeerJS 失败，请刷新页面');
    return;
  }

  G.peer = new Peer('poker-' + roomId, { debug: 0 });

  G.peer.on('open', () => {
    setStatus(true);
    DOM.roomDisplay.textContent = roomId;
    showGame();

    /* Host joins as seat 0 */
    G.mySeatId = 0;
    G.players = [makePlayer(0, name, true)];
    G.peerConns = [];
    render();
    DOM.startBtn.classList.remove('hidden');
    DOM.nextHandBtn.classList.add('hidden');
    hideActions();
    setMessage('房间已创建，等待玩家加入… 至少需要 2 名玩家');
    log('房间 ' + roomId + ' 已创建，分享链接给朋友们吧！', true);
  });

  G.peer.on('connection', (conn) => {
    conn.on('data', (data) => handleHostMessage(conn, data));
    conn.on('close', () => handleDisconnect(conn));
    conn.on('error', () => handleDisconnect(conn));
  });

  G.peer.on('error', (err) => {
    console.error('PeerJS error:', err);
    if (err.type === 'unavailable-id') {
      setMessage('房间号冲突，请重试');
    }
  });

  /* Copy room link */
  DOM.copyBtn.onclick = () => {
    navigator.clipboard.writeText(getJoinUrl()).then(() => {
      setMessage('链接已复制！');
      setTimeout(() => setMessage(''), 2000);
    }).catch(() => {
      /* fallback */
      DOM.roomDisplay.textContent = roomId;
      setMessage('房间号: ' + roomId);
    });
  };
}

function makePlayer(id, name, isHost) {
  return { id, name, chips: 1000, bet: 0, folded: false, allIn: false, connected: true, isHost, holeCards: [], totalBetHand: 0 };
}

function handleHostMessage(conn, data) {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (_) { return; }
  }
  if (!data || !data.type) return;

  if (data.type === 'join') handleJoin(conn, data.name);
  else if (data.type === 'action') handlePlayerAction(conn, data);
}

function handleJoin(conn, name) {
  if (G.players.length >= MAX_PLAYERS) {
    conn.send(JSON.stringify({ type: 'join_rejected', reason: '房间已满' }));
    return;
  }

  /* Deduplicate name */
  let finalName = name.trim() || '玩家' + (G.players.length + 1);
  const existingNames = G.players.map((p) => p.name);
  if (existingNames.includes(finalName)) {
    let suffix = 2;
    while (existingNames.includes(finalName + ' ' + suffix)) suffix++;
    finalName = finalName + ' ' + suffix;
  }

  /* Assign seat: use first free among 1..7 (host has 0) */
  let seatId = -1;
  for (let i = 1; i < MAX_PLAYERS; i++) {
    if (!G.players.find((p) => p.id === i)) { seatId = i; break; }
  }
  if (seatId === -1) {
    conn.send(JSON.stringify({ type: 'join_rejected', reason: '房间已满' }));
    return;
  }

  const pl = makePlayer(seatId, finalName, false);
  G.players.push(pl);
  G.peerConns[seatId] = conn;

  conn.send(JSON.stringify({ type: 'join_accepted', seatId, players: G.players.map(stripHole) }));
  log(finalName + ' 加入了房间');
  setMessage(finalName + ' 已加入');

  broadcast({ type: 'state_sync', state: exportState() });
  render();
}

function handleDisconnect(conn) {
  const idx = G.peerConns.indexOf(conn);
  if (idx === -1) return;
  G.peerConns[idx] = null;
  const pl = G.players.find((p) => p.id === idx);
  if (pl) {
    pl.connected = false;
    pl.folded = true;
    log(pl.name + ' 断开连接');
    /* If the disconnected player was mid-turn, they're now folded; advance */
    if (G.currentTurn === idx) {
      clearTurnTimers();
      G.waitingForAction = false;
      G.currentTurn = -1;
      checkRoundEnd(idx);
    } else {
      checkRoundEnd(-1);
    }
  }
  broadcast({ type: 'state_sync', state: exportState() });
  render();
}

// ==================== NETWORKING — BROADCAST / SEND ====================
function safeSend(conn, data) {
  if (!conn || !conn.open) return;
  try { conn.send(typeof data === 'string' ? data : JSON.stringify(data)); }
  catch (_) { /* stale connection */ }
}

function broadcast(msg) {
  const s = JSON.stringify(msg);
  G.peerConns.forEach((conn) => safeSend(conn, s));
}

function sendTo(seatId, msg) {
  safeSend(G.peerConns[seatId], JSON.stringify(msg));
}

function sendToPeer(msg) {
  safeSend(G.hostConn, JSON.stringify(msg));
}

// ==================== NETWORKING — CLIENT ====================
function clientJoinRoom(roomId, name) {
  G.roomId = roomId;
  G.isHost = false;

  if (typeof Peer === 'undefined') {
    setMessage('加载 PeerJS 失败');
    return;
  }

  G.peer = new Peer(undefined, { debug: 0 });

  G.peer.on('open', () => {
    const conn = G.peer.connect('poker-' + roomId, { reliable: true });
    G.hostConn = conn;

    conn.on('open', () => {
      setStatus(true);
      conn.send(JSON.stringify({ type: 'join', name: name.trim() || '玩家' }));
      showGame();
      DOM.startBtn.classList.add('hidden');
      DOM.nextHandBtn.classList.add('hidden');
      hideActions();
      setMessage('正在加入房间…');
    });

    conn.on('data', (data) => {
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { return; } }
      handleServerMsg(data);
    });

    conn.on('close', () => {
      setStatus(false);
      setMessage('与房主的连接已断开');
      log('连接已断开', false);
    });

    conn.on('error', () => {
      setStatus(false);
      setMessage('连接出错');
    });
  });

  G.peer.on('error', (err) => {
    console.error('PeerJS error:', err);
    if (err.type === 'peer-unavailable') {
      setMessage('房间不存在，请检查房间号');
    } else {
      setMessage('连接失败，请重试');
    }
  });
}

function handleServerMsg(data) {
  if (data.type === 'join_accepted') {
    G.mySeatId = data.seatId;
    G.players = data.players || [];
    setMessage('已加入房间');
    log('你已加入房间，等待房主开始游戏', true);
    if (DOM.roomDisplay) DOM.roomDisplay.textContent = G.roomId;
    render();
  } else if (data.type === 'join_rejected') {
    setMessage(data.reason || '加入被拒绝');
    showLobby();
  } else if (data.type === 'state_sync') {
    applyState(data.state);
  } else if (data.type === 'hole_cards') {
    const me = G.players.find((p) => p.id === G.mySeatId);
    if (me) me.holeCards = data.cards;
    render();
  } else if (data.type === 'your_turn') {
    G.waitingForAction = true;
    G.currentTurn = G.mySeatId;
    setupActionUI(data);
    startTurnTimer(60);
    setMessage('轮到你了！');
    render();
  } else if (data.type === 'showdown') {
    const hands = data.hands || [];
    /* Inject hole cards for all players so they are revealed on render */
    for (const h of hands) {
      const pl = G.players.find((p) => p.id === h.playerId);
      if (pl) pl.holeCards = h.cards;
    }
    G.showdownHands = hands;
    render();
  } else if (data.type === 'hand_result') {
    clearTurnTimers();
    G.waitingForAction = false;
    G.currentTurn = -1;
    hideActions();
    DOM.startBtn.classList.add('hidden');
    if (G.isHost) DOM.nextHandBtn.classList.remove('hidden');
    setMessage(data.message || '本局结束');
    log(data.message || '本局结束', false);
    render();
  } else if (data.type === 'next_hand') {
    clearTurnTimers();
    G.waitingForAction = false;
    applyState(data.state);
    DOM.nextHandBtn.classList.add('hidden');
    /* If I'm the host, show start button again */
    if (G.isHost) DOM.startBtn.classList.remove('hidden');
    render();
  } else if (data.type === 'error') {
    setMessage(data.message || '错误');
  }
}

function applyState(st) {
  if (!st) return;
  G.phase = st.phase || G.phase;
  G.pot = st.pot || 0;
  G.handNumber = st.handNumber || 0;
  G.dealerPos = st.dealerPos;
  G.currentTurn = st.currentTurn != null ? st.currentTurn : G.currentTurn;
  G.communityCards = st.communityCards || [];
  G.lastRaiseSize = st.lastRaiseSize || 0;

  if (st.players) {
    /* Merge incoming player state with existing (preserve hole cards locally) */
    const myId = G.mySeatId;
    for (const sp of st.players) {
      let existing = G.players.find((p) => p.id === sp.id);
      if (existing) {
        const myHole = existing.holeCards;
        Object.assign(existing, sp);
        if (sp.id === myId && myHole && myHole.length) existing.holeCards = myHole;
        else if (sp.id !== myId && G.phase !== 'showdown') existing.holeCards = [];
      } else {
        G.players.push({ ...sp, holeCards: (sp.id === myId && sp.holeCards) ? sp.holeCards : [] });
      }
    }
    /* Remove players not in sync if they left */
    G.players = G.players.filter((p) => st.players.find((sp) => sp.id === p.id));
  }
  render();
}

function exportState() {
  return {
    phase: G.phase,
    players: G.players.map(stripHole),
    pot: G.pot,
    handNumber: G.handNumber,
    dealerPos: G.dealerPos,
    currentTurn: G.currentTurn,
    communityCards: G.communityCards,
    lastRaiseSize: G.lastRaiseSize,
  };
}

function stripHole(pl) {
  return { id: pl.id, name: pl.name, chips: pl.chips, bet: pl.bet, folded: pl.folded, allIn: pl.allIn, connected: pl.connected, isHost: pl.isHost, holeCards: [], totalBetHand: pl.totalBetHand || 0 };
}

// ==================== UI — ACTION PANEL SETUP (client) ====================
function setupActionUI(data) {
  hideActions();
  DOM.startBtn.classList.add('hidden');
  DOM.nextHandBtn.classList.add('hidden');

  const me = G.players.find((p) => p.id === G.mySeatId);
  if (!me) return;

  const { actions, currentBet, minRaise, maxRaise } = data;

  if (actions.includes('fold')) DOM.foldBtn.classList.remove('hidden');
  if (actions.includes('check')) DOM.checkBtn.classList.remove('hidden');
  if (actions.includes('call')) {
    DOM.callBtn.classList.remove('hidden');
    const callAmt = currentBet - (me.bet || 0);
    DOM.callBtn.textContent = '跟注 ' + Math.max(0, callAmt);
  }
  if (actions.includes('raise')) {
    DOM.raiseArea.classList.remove('hidden');
    const minR = minRaise || currentBet + BB;
    const maxR = maxRaise || me.chips;
    DOM.raiseSlider.min = minR;
    DOM.raiseSlider.max = Math.max(minR + 1, maxR);
    DOM.raiseSlider.value = String(minR);
    DOM.raiseAmount.textContent = minR;

    DOM.raiseSlider.oninput = () => {
      const val = parseInt(DOM.raiseSlider.value, 10);
      DOM.raiseAmount.textContent = val;
    };
  }
  if (actions.includes('allin')) {
    DOM.allInBtn.classList.remove('hidden');
  }
}

// ==================== HOST GAME ENGINE ====================
/* The host (seat 0) manages the full game state machine */

function hostStartGame() {
  if (!G.isHost) return;
  const active = G.players.filter((p) => p.connected);
  if (active.length < 2) {
    setMessage('至少需要 2 名玩家才能开始');
    return;
  }

  G.handNumber++;
  G.phase = 'preflop';
  G.deck = shuffle(createDeck());
  G.communityCards = [];
  G.pot = 0;
  G.lastRaiseSize = 0;
  G.currentTurn = -1;
  G.waitingForAction = false;
  G.bbActedThisRound = false;
  G.bigBlindId = -1;
  DOM.nextHandBtn.classList.add('hidden');

  /* Reset all connected players */
  for (const pl of G.players) {
    pl.folded = !pl.connected;
    pl.allIn = false;
    pl.holeCards = [];
    pl.bet = 0;
    pl.totalBetHand = 0;
  }

  /* Deal hole cards */
  for (const pl of G.players) {
    if (!pl.folded) {
      pl.holeCards = [draw(), draw()];
    }
  }

  /* Post blinds */
  const dealerIdx = G.dealerPos;
  const activePlayers = G.players.filter((p) => !p.folded);
  const smallBlindPl = getNextActivePlayer(dealerIdx);
  const bigBlindPl = getNextActivePlayer(smallBlindPl ? smallBlindPl.id : dealerIdx);

  if (smallBlindPl) postBet(smallBlindPl, Math.min(SB, smallBlindPl.chips));
  if (bigBlindPl) postBet(bigBlindPl, Math.min(BB, bigBlindPl.chips));
  G.bigBlindId = bigBlindPl ? bigBlindPl.id : -1;

  G.lastRaiseSize = BB;

  log('第 ' + G.handNumber + ' 局开始，底注 ' + SB + '/' + BB, true);
  setMessage('新局开始，翻牌前');

  /* Send hole cards privately */
  for (const pl of G.players) {
    if (!pl.folded) {
      if (pl.id === 0) {
        /* Host's own cards are already set */
      } else {
        sendTo(pl.id, { type: 'hole_cards', cards: pl.holeCards });
      }
    }
  }

  broadcast({ type: 'state_sync', state: exportState() });
  render();

  /* Start betting — first to act is after big blind */
  const firstToAct = getNextActivePlayer(bigBlindPl ? bigBlindPl.id : dealerIdx);
  if (firstToAct) startTurn(firstToAct.id);
}

function postBet(pl, amount) {
  const actual = Math.min(pl.chips, amount);
  pl.chips -= actual;
  pl.bet += actual;
  pl.totalBetHand += actual;
  G.pot += actual;
  if (pl.chips === 0) pl.allIn = true;
  return actual;
}

function getNextActivePlayer(fromId) {
  const active = G.players.filter((p) => !p.folded && !p.allIn);
  if (!active.length) return null;
  const sorted = [...active].sort((a, b) => {
    const aPos = (a.id - fromId + MAX_PLAYERS) % MAX_PLAYERS;
    const bPos = (b.id - fromId + MAX_PLAYERS) % MAX_PLAYERS;
    return aPos - bPos;
  });
  /* Must be strictly after fromId */
  return sorted.find((p) => (p.id - fromId + MAX_PLAYERS) % MAX_PLAYERS > 0) || null;
}

function getCurrentBet() {
  return Math.max(...G.players.map((p) => p.bet), 0);
}

function allBetsEqual() {
  const currentBet = getCurrentBet();
  const active = G.players.filter((p) => !p.folded && !p.allIn);
  return active.every((p) => p.bet === currentBet);
}

function activePlayerCount() {
  return G.players.filter((p) => !p.folded).length;
}

// ==================== HOST — TURN MANAGEMENT ====================
function startTurn(playerId) {
  if (!G.isHost) return;
  G.waitingForAction = true;
  G.currentTurn = playerId;

  const pl = G.players.find((p) => p.id === playerId);
  if (!pl) { G.waitingForAction = false; return; }

  const currentBet = getCurrentBet();
  const toCall = currentBet - pl.bet;

  const actions = ['fold'];
  if (toCall === 0) {
    actions.push('check');
  } else {
    actions.push('call');
  }
  /* Can raise if they have chips */
  if (pl.chips > 0 && activePlayerCount() >= 2) {
    const minRaiseAmount = Math.max(G.lastRaiseSize || BB, BB);
    if (toCall + minRaiseAmount <= pl.chips || toCall < pl.chips) {
      actions.push('raise');
    }
    /* All-in: they can go all-in instead of folding/calling */
    actions.push('allin');
  }

  broadcast({ type: 'state_sync', state: exportState() });
  render();

  if (pl.id === 0) {
    /* Host's turn — show controls locally */
    G.waitingForAction = true;
    const minRaise = Math.max(G.lastRaiseSize || BB, BB);
    setupActionUI({
      actions,
      currentBet,
      minRaise: currentBet + minRaise,
      maxRaise: pl.chips,
    });
    startTurnTimer(60);
    /* Auto-fold on timeout for host too */
    G.autoFoldTimer = setTimeout(() => {
      if (G.waitingForAction && G.currentTurn === playerId) {
        log(pl.name + ' 超时，自动弃牌');
        applyAction(pl.id, 'fold', 0);
      }
    }, TURN_TIMEOUT_MS);
    setMessage('轮到你了！');
  } else {
    sendTo(pl.id, {
      type: 'your_turn',
      actions,
      currentBet,
      minRaise: currentBet + (toCall > 0 ? Math.max(G.lastRaiseSize || BB, BB) : BB),
      maxRaise: pl.chips,
      pot: G.pot,
    });
    /* Auto-fold on timeout (separate from UI turn timer) */
    G.autoFoldTimer = setTimeout(() => {
      if (G.waitingForAction && G.currentTurn === playerId) {
        log(pl.name + ' 超时，自动弃牌');
        applyAction(pl.id, 'fold', 0);
      }
    }, TURN_TIMEOUT_MS);
  }
}

// ==================== HOST — PLAYER ACTION ====================
function handlePlayerAction(conn, data) {
  if (!G.isHost || !G.waitingForAction) return;
  const idx = G.peerConns.indexOf(conn);
  if (idx === -1 || idx !== G.currentTurn) return;

  clearTurnTimers();
  applyAction(idx, data.action, data.amount || 0);
}

function applyAction(playerId, action, amount) {
  if (!G.isHost) return;
  const pl = G.players.find((p) => p.id === playerId);
  if (!pl || pl.folded) return;

  clearTurnTimers();
  G.waitingForAction = false;
  G.currentTurn = -1;

  const currentBet = getCurrentBet();
  const toCall = currentBet - pl.bet;

  switch (action) {
    case 'fold':
      pl.folded = true;
      log(pl.name + ' 弃牌');
      break;
    case 'check':
      log(pl.name + ' 过牌');
      break;
    case 'call':
      postBet(pl, toCall);
      log(pl.name + ' 跟注 ' + toCall);
      break;
    case 'raise':
      if (amount !== undefined && amount > 0) {
        /* Floor to legal min-raise (defensive: reject non-host or crafted input) */
        const minRaiseAmt = Math.max(G.lastRaiseSize || BB, BB);
        const minTotal = currentBet + minRaiseAmt;
        let raiseTotal = Math.max(amount, minTotal);
        /* Cap at what the player can actually put in */
        raiseTotal = Math.min(raiseTotal, pl.chips + pl.bet);
        const raiseSize = raiseTotal - pl.bet;
        if (raiseSize > 0) {
          postBet(pl, raiseSize);
          /* Actual increment above the table current bet (postBet caps at chips) */
          G.lastRaiseSize = pl.bet - currentBet;
          log(pl.name + ' 加注到 ' + pl.bet);
        }
      }
      break;
    case 'allin':
      postBet(pl, pl.chips);
      log(pl.name + ' ALL-IN ' + pl.totalBetHand);
      break;
  }

  /* Track BB's voluntary action for BB option logic */
  if (G.phase === 'preflop' && pl.id === G.bigBlindId) {
    G.bbActedThisRound = true;
  }

  if (activePlayerCount() <= 1) {
    /* Only one player left — they win */
    const winner = G.players.find((p) => !p.folded);
    endHand(winner, '其他玩家已弃牌，');
    return;
  }

  /* Re-broadcast state before checking round end */
  broadcast({ type: 'state_sync', state: exportState() });
  render();

  checkRoundEnd(playerId);
}

function checkRoundEnd(actingPlayerId) {
  if (!G.isHost) return;

  if (activePlayerCount() <= 1) {
    const winner = G.players.find((p) => !p.folded);
    endHand(winner, '其他玩家已弃牌，');
    return;
  }

  if (allBetsEqual()) {
    /* Preflop: BB gets option to raise after all calls */
    if (G.phase === 'preflop' && !G.bbActedThisRound) {
      const bb = G.players.find((p) => p.id === G.bigBlindId);
      if (bb && !bb.folded && !bb.allIn) {
        startTurn(bb.id);
        return;
      }
    }
    advanceStreet();
  } else {
    /* Next player is strictly after the acting player */
    const fromId = (actingPlayerId != null) ? actingPlayerId : G.dealerPos;
    const next = getNextActivePlayer(fromId);
    if (next) {
      startTurn(next.id);
    } else {
      advanceStreet();
    }
  }
}

// ==================== HOST — STREET ADVANCEMENT ====================
function advanceStreet() {
  if (!G.isHost) return;

  /* Iterate through streets — bounded at 4 iterations (preflop→flop→turn→river).
     This is iterative, not recursive, to avoid stack growth for all-in runouts. */
  for (let iter = 0; iter < 4; iter++) {
    G.waitingForAction = false;
    G.currentTurn = -1;

    for (const pl of G.players) pl.bet = 0;
    G.lastRaiseSize = 0;

    switch (G.phase) {
      case 'preflop':
        G.communityCards.push(draw(), draw(), draw());
        G.phase = 'flop';
        setMessage('翻牌完成');
        log('翻牌：' + G.communityCards.map((c) => c.rank + c.suitLabel).join(' '));
        break;
      case 'flop':
        G.communityCards.push(draw());
        G.phase = 'turn';
        setMessage('转牌');
        log('转牌：' + G.communityCards[G.communityCards.length - 1].rank + G.communityCards[G.communityCards.length - 1].suitLabel);
        break;
      case 'turn':
        G.communityCards.push(draw());
        G.phase = 'river';
        setMessage('河牌');
        log('河牌：' + G.communityCards[G.communityCards.length - 1].rank + G.communityCards[G.communityCards.length - 1].suitLabel);
        break;
      case 'river':
        hostShowdown();
        return;
      default:
        return;
    }

    broadcast({ type: 'state_sync', state: exportState() });
    render();

    /* If any non-all-in player exists, start the betting round */
    const first = getNextActivePlayer(G.dealerPos);
    if (first) {
      startTurn(first.id);
      return;
    }
    /* Otherwise continue loop: all-in runout, deal next street */
  }
}

// ==================== HOST — SHOWDOWN ====================
function hostShowdown() {
  G.phase = 'showdown';
  G.waitingForAction = false;
  G.currentTurn = -1;

  const contenders = G.players.filter((p) => !p.folded);
  const ranked = contenders
    .map((p) => ({ player: p, value: evaluateBest([...p.holeCards, ...G.communityCards]) }))
    .sort((a, b) => cmpVal(b.value, a.value));

  const best = ranked[0].value;
  const winners = ranked.filter((r) => cmpVal(r.value, best) === 0);
  const share = Math.floor(G.pot / winners.length);

  for (const w of winners) {
    w.player.chips += share;
  }

  const names = winners.map((w) => w.player.name).join('、');
  const handDesc = describeValue(best);
  const result = winners.length > 1 ? names + ' 平分底池' : names + ' 赢得底池';
  const msg = '摊牌：' + result + '，牌型 ' + handDesc;
  log(msg);
  setMessage(result + '，' + handDesc);

  /* Send showdown hands to everyone for reveal */
  const hands = contenders.map((p) => ({
    playerId: p.id,
    name: p.name,
    cards: p.holeCards,
    handName: HAND_NAMES[ranked.find((r) => r.player.id === p.id)?.value.rank] || '',
  }));

  broadcast({ type: 'showdown', hands });
  broadcast({ type: 'state_sync', state: exportState() });
  render();

  /* Announce result */
  broadcast({ type: 'hand_result', message: result + '，' + handDesc });
  DOM.nextHandBtn.classList.remove('hidden');
  DOM.startBtn.classList.add('hidden');
  hideActions();

  /* Auto-advance to next hand after delay */
  clearTimeout(G.autoNextHandTimer);
  G.autoNextHandTimer = setTimeout(() => {
    if (G.isHost) hostNextHand();
  }, AUTO_NEXT_HAND_DELAY);
}

function endHand(winner, reason) {
  G.phase = 'showdown';
  G.waitingForAction = false;
  G.currentTurn = -1;
  clearTurnTimers();

  if (winner) {
    winner.chips += G.pot;
    const msg = reason + winner.name + ' 赢得 ' + G.pot;
    log(msg);
    setMessage(winner.name + ' 赢得本局');
    broadcast({ type: 'hand_result', message: msg });
  }

  hideActions();
  DOM.nextHandBtn.classList.remove('hidden');
  DOM.startBtn.classList.add('hidden');
  broadcast({ type: 'state_sync', state: exportState() });
  render();

  /* Auto-advance to next hand after delay */
  clearTimeout(G.autoNextHandTimer);
  G.autoNextHandTimer = setTimeout(() => {
    if (G.isHost) hostNextHand();
  }, AUTO_NEXT_HAND_DELAY);
}

// ==================== CLIENT — LOCAL ACTION HANDLERS ====================
function sendAction(action, amount) {
  if (!G.waitingForAction) return;
  clearTurnTimers();
  G.waitingForAction = false;
  hideActions();

  if (G.isHost) {
    applyAction(G.mySeatId, action, amount || 0);
  } else {
    sendToPeer({ type: 'action', action, amount: amount || 0 });
  }
}

// ==================== HOST — NEXT HAND ====================
function hostNextHand() {
  if (!G.isHost) return;
  clearTimeout(G.autoNextHandTimer);
  DOM.nextHandBtn.classList.add('hidden');
  DOM.startBtn.classList.remove('hidden');

  /* Rotate dealer */
  G.dealerPos = (G.dealerPos + 1) % MAX_PLAYERS;
  /* Replenish busted players */
  for (const pl of G.players) {
    if (pl.chips <= 0) pl.chips = 1000;
  }

  G.phase = 'lobby';
  G.communityCards = [];
  G.pot = 0;
  G.currentTurn = -1;
  G.waitingForAction = false;
  G.bbActedThisRound = false;
  G.bigBlindId = -1;

  /* Reset hand state for all */
  for (const pl of G.players) {
    pl.folded = false;
    pl.allIn = false;
    pl.holeCards = [];
    pl.bet = 0;
    pl.totalBetHand = 0;
  }

  broadcast({ type: 'next_hand', state: exportState() });
  render();
  setMessage('准备开始新局');
  log('新局准备就绪', false);
}

// ==================== UI — EVENT BINDING ====================
function initUI() {
  /* Lobby tabs */
  DOM.lobbyTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      DOM.lobbyTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      DOM.createPanel.classList.toggle('active', tab.dataset.tab === 'create');
      DOM.joinPanel.classList.toggle('active', tab.dataset.tab === 'join');
    });
  });

  /* Create room */
  DOM.createBtn.addEventListener('click', () => {
    const name = DOM.nameInputC.value.trim() || '房主';
    hostCreateRoom(name);
  });

  DOM.nameInputC.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') DOM.createBtn.click();
  });

  /* Join room */
  DOM.joinBtn.addEventListener('click', () => {
    const name = DOM.nameInputJ.value.trim() || '玩家';
    const roomId = DOM.roomIdInput.value.trim().toUpperCase();
    if (!roomId) { setMessage('请输入房间号'); return; }
    /* If already connected, clean up */
    if (G.peer) { G.peer.destroy(); G.peer = null; }
    clientJoinRoom(roomId, name);
  });

  DOM.nameInputJ.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') DOM.joinBtn.click();
  });

  DOM.roomIdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') DOM.joinBtn.click();
  });

  /* Game actions */
  DOM.startBtn.addEventListener('click', hostStartGame);
  DOM.nextHandBtn.addEventListener('click', hostNextHand);
  DOM.foldBtn.addEventListener('click', () => sendAction('fold'));
  DOM.checkBtn.addEventListener('click', () => sendAction('check'));
  DOM.callBtn.addEventListener('click', () => sendAction('call'));
  DOM.raiseBtn.addEventListener('click', () => {
    const amt = parseInt(DOM.raiseSlider.value, 10);
    sendAction('raise', amt);
  });
  DOM.allInBtn.addEventListener('click', () => sendAction('allin'));

  /* Raise slider live update */
  DOM.raiseSlider.addEventListener('input', () => {
    DOM.raiseAmount.textContent = DOM.raiseSlider.value;
  });
}

// ==================== URL PARSE & INIT ====================
function init() {
  initUI();
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');

  if (room) {
    /* Pre-fill join panel */
    DOM.roomIdInput.value = room.toUpperCase();
    /* Show join tab */
    DOM.lobbyTabs.forEach((t) => t.classList.remove('active'));
    DOM.lobbyTabs[1].classList.add('active');  // join tab
    DOM.createPanel.classList.remove('active');
    DOM.joinPanel.classList.add('active');
    /* Focus name input */
    DOM.nameInputJ.focus();
  } else {
    DOM.nameInputC.focus();
  }

  showLobby();
  setMessage('创建或加入房间开始游戏');
}

/* Start when DOM ready */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
