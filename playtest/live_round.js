const { io } = require('socket.io-client');

const SERVER = process.env.GAME_SERVER_URL || 'https://three-spades.onrender.com';
const DEADLINE_MS = Number(process.env.PLAYTEST_TIMEOUT_MS || 240000);
let finished = false;
let lastPhase = '';
let roomCode = '';
let lastActionKey = '';
let actionBusy = false;
let stateCount = 0;
let playCount = 0;
let bidSent = false;
let contractSent = false;

function fail(msg) {
  if (finished) return;
  finished = true;
  console.error(`PLAYTEST_FAIL: ${msg}`);
  try { socket.disconnect(); } catch {}
  setTimeout(() => process.exit(1), 250);
}

function ok(msg) {
  if (finished) return;
  finished = true;
  console.log(`PLAYTEST_PASS: ${msg}`);
  try { socket.emit('leaveRoom', {}, () => socket.disconnect()); } catch { try { socket.disconnect(); } catch {} }
  setTimeout(() => process.exit(0), 300);
}

function emitAck(event, payload = {}, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack timeout`)), timeout);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      if (res && res.ok === false) reject(new Error(`${event}: ${res.error || 'rejected'}`));
      else resolve(res || { ok: true });
    });
  });
}

function chooseTrump(hand = []) {
  const counts = { S: 0, H: 0, D: 0, C: 0 };
  for (const c of hand) if (counts[c.suit] != null) counts[c.suit]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'S';
}

function choosePartnerCards(st) {
  const owned = new Set((st.hand || []).map(c => c.id || `${c.copy || 1}-${c.suit}-${c.rank}`));
  const deckCount = Number(st.deckCount || 1);
  const ranks = ['A','K','Q','J','10','9','8','7','6','5','4','3','2'];
  const suits = ['S','H','D','C'];
  const options = [];
  for (let copy = 1; copy <= deckCount; copy++) {
    for (const rank of ranks) for (const suit of suits) {
      const id = `${copy}-${suit}-${rank}`;
      if (!owned.has(id)) options.push({ copy, suit, rank });
    }
  }
  return options.slice(0, Number(st.partnerCount || 1));
}

async function actOnState(st) {
  if (finished || actionBusy || !st) return;
  const me = st.players?.[st.viewerIndex];
  if (!me && !st.spectator) return;

  if (st.phase !== lastPhase) {
    lastPhase = st.phase;
    console.log(`PHASE: ${st.phase}`);
  }

  if (st.phase === 'lobby' && st.host && !st.ranked) {
    const othersReady = (st.players || []).filter((p, i) => i !== st.viewerIndex && !p.bot && p.connected).every(p => p.ready);
    if (!othersReady) return;
    const key = `lobby:${me?.ready}`;
    if (lastActionKey === key) return;
    lastActionKey = key;
    actionBusy = true;
    try {
      if (!me?.ready) {
        console.log('ACTION: mark ready');
        await emitAck('toggleReady', {});
      } else {
        console.log('ACTION: start game');
        await emitAck('startGame', {});
      }
    } catch (e) { fail(e.message); }
    finally { actionBusy = false; }
    return;
  }

  if (st.phase === 'bidding' && st.bid?.turnIndex === st.viewerIndex) {
    const max = Number(st.bid.max || 250);
    const key = `bid:${max}:${(st.bid.history || []).length}`;
    if (lastActionKey === key) return;
    lastActionKey = key;
    actionBusy = true;
    try {
      console.log(`ACTION: bid ${max}`);
      await emitAck('bid', { amount: max, pass: false });
      bidSent = true;
    } catch (e) { fail(e.message); }
    finally { actionBusy = false; }
    return;
  }

  if (st.phase === 'contract' && st.bid?.bidderIndex === st.viewerIndex && !contractSent) {
    const partnerCards = choosePartnerCards(st);
    if (partnerCards.length !== Number(st.partnerCount || 1)) return fail('could not choose partner card(s)');
    const trump = chooseTrump(st.hand || []);
    actionBusy = true;
    contractSent = true;
    try {
      console.log(`ACTION: contract trump=${trump} partners=${partnerCards.map(c => `${c.rank}${c.suit}`).join(',')}`);
      await emitAck('contract', { trump, partnerCards });
    } catch (e) { fail(e.message); }
    finally { actionBusy = false; }
    return;
  }

  if (st.phase === 'playing' && !st.trickResolving && st.turnIndex === st.viewerIndex) {
    const legalIds = st.legalCardIds || [];
    if (!legalIds.length) return;
    const cardId = legalIds[0];
    const key = `play:${st.round}:${st.trickNumber}:${cardId}`;
    if (lastActionKey === key) return;
    lastActionKey = key;
    actionBusy = true;
    try {
      const card = (st.hand || []).find(c => c.id === cardId);
      console.log(`ACTION: play ${card ? `${card.rank}${card.suit}` : cardId}`);
      await emitAck('playCard', { cardId });
      playCount++;
    } catch (e) { fail(e.message); }
    finally { actionBusy = false; }
    return;
  }

  if (st.phase === 'roundEnd') {
    const rs = st.roundSummary || {};
    const total = Number(rs.bidderPoints || 0) + Number(rs.defensePoints || 0);
    const summary = `room=${st.code} bid=${st.bid?.current} bidder=${rs.bidderPoints} defense=${rs.defensePoints} total=${total}/${st.totalPoints} made=${rs.made} tricks=${(st.trickHistory || []).length} testerPlays=${playCount}`;
    if (!bidSent) return fail(`round ended without tester bidding: ${summary}`);
    if (!contractSent) return fail(`round ended without tester choosing contract: ${summary}`);
    if ((st.trickHistory || []).length !== Number(st.totalTricks || 13)) return fail(`trick count mismatch: ${summary}`);
    if (total !== Number(st.totalPoints || total)) return fail(`score total mismatch: ${summary}`);
    return ok(summary);
  }
}

const socket = io(SERVER, {
  path: '/socket.io',
  transports: ['polling', 'websocket'],
  upgrade: true,
  timeout: 60000,
  reconnection: true,
  reconnectionAttempts: 8,
  reconnectionDelay: 1500,
  reconnectionDelayMax: 8000
});

setTimeout(() => fail(`overall timeout; lastPhase=${lastPhase}; states=${stateCount}; plays=${playCount}`), DEADLINE_MS);

socket.on('connect', async () => {
  console.log(`CONNECTED: ${socket.id} -> ${SERVER}`);
  try {
    const res = await emitAck('createRoom', {
      name: 'OpenAI QA', avatar: '🧪', playerCount: 4, deckCount: 1,
      isPublic: false, botDifficulty: 'easy', botPersonality: 'balanced', privatePin: '',
      turnTimeoutMs: 15000, spectatorDelayMs: 0, preset: 'practice', seriesBestOf: 1,
      teamMode: 'random', tableTheme: 'classic', voiceEnabled: false, spectatorsEnabled: false
    }, 30000);
    roomCode = res.code || '';
    console.log(`ROOM_CREATED: ${roomCode}`);
  } catch (e) { fail(e.message); }
});

socket.on('state', (st) => {
  stateCount++;
  Promise.resolve().then(() => actOnState(st)).catch(e => fail(e.stack || e.message));
});

socket.on('connect_error', e => console.log(`CONNECT_ERROR: ${e.message}`));
socket.on('disconnect', reason => { if (!finished) console.log(`DISCONNECT: ${reason}`); });
socket.on('roomClosed', x => { if (!finished) fail(`room closed: ${JSON.stringify(x)}`); });
socket.on('kicked', x => { if (!finished) fail(`kicked: ${JSON.stringify(x)}`); });
