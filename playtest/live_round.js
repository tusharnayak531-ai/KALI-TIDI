const { io } = require('socket.io-client');

const SERVER = process.env.GAME_SERVER_URL || 'https://three-spades.onrender.com';
const DEADLINE_MS = Number(process.env.PLAYTEST_TIMEOUT_MS || 240000);
let finished = false;
let lastPhase = '';
let roomCode = '';
let roomCreated = false;
let lastActionKey = '';
let stateCount = 0;
let playCount = 0;
let bidSent = false;
let contractSent = false;
let latestState = null;
let lastProgressAt = Date.now();
let lastStateSig = '';

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
  try { socket.emit('leaveRoom', {}); } catch {}
  try { socket.disconnect(); } catch {}
  setTimeout(() => process.exit(0), 300);
}

function emitAck(event, payload = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ack timeout`)), timeout);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      if (res && res.ok === false) reject(new Error(`${event}: ${res.error || 'rejected'}`));
      else resolve(res || { ok: true });
    });
  });
}

function fire(event, payload = {}) {
  console.log(`EMIT: ${event}`);
  socket.emit(event, payload, res => {
    if (res?.ok === false) console.log(`ACK_REJECTED: ${event}: ${res.error || 'rejected'}`);
    else if (res) console.log(`ACK: ${event}`);
  });
}

function chooseTrump(hand = []) {
  const counts = { S: 0, H: 0, D: 0, C: 0 };
  for (const c of hand) if (counts[c.suit] != null) counts[c.suit]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'S';
}

function choosePartnerCards(st) {
  const owned = new Set((st.hand || []).map(c => c.id));
  const copies = Number(st.deckCount || 1) === 2 ? [1, 2] : [1];
  const ranks = (st.availableRanks || ['2','3','4','5','6','7','8','9','10','J','Q','K','A']).slice().reverse();
  const options = [];
  for (const copy of copies) {
    for (const suit of ['S','H','D','C']) {
      for (const rank of ranks) {
        const id = `${copy}-${suit}-${rank}`;
        if (!owned.has(id)) options.push({ copy, suit, rank });
      }
    }
  }
  return options.slice(0, Number(st.partnerCount || 1));
}

function stateSignature(st) {
  return [st.phase,st.round,st.bid?.turnIndex,st.bid?.current,st.turnIndex,st.trickNumber,st.trickResolving,st.hand?.length,st.players?.[st.viewerIndex]?.ready,st.calledPartners?.length,st.roundSummary?.bidderPoints,st.roundSummary?.defensePoints].join('|');
}

function actOnState(st) {
  if (finished || !st) return;
  latestState = st;
  const sig = stateSignature(st);
  if (sig !== lastStateSig) { lastStateSig = sig; lastProgressAt = Date.now(); }

  const me = st.players?.[st.viewerIndex];
  if (!me && !st.spectator) return;
  if (st.phase !== lastPhase) { lastPhase = st.phase; lastActionKey = ''; console.log(`PHASE: ${st.phase}`); }

  // createRoom can broadcast the first lobby state before its callback returns.
  // Do not send any room actions until the createRoom acknowledgement arrives.
  if (!roomCreated) {
    console.log('WAIT: room creation acknowledgement');
    return;
  }

  if (st.phase === 'lobby' && st.host && !st.ranked) {
    const othersReady = (st.players || []).filter((p, i) => i !== st.viewerIndex && !p.bot && p.connected).every(p => p.ready);
    if (!othersReady) return;
    if (!me?.ready) {
      const key = 'lobby:ready';
      if (lastActionKey === key) return;
      lastActionKey = key;
      console.log('ACTION: mark ready');
      fire('toggleReady', {});
      return;
    }
    const key = 'lobby:start';
    if (lastActionKey === key) return;
    lastActionKey = key;
    console.log('ACTION: start game');
    fire('startGame', {});
    return;
  }

  if (st.phase === 'bidding' && st.bid?.turnIndex === st.viewerIndex) {
    const max = Number(st.bid.max || 250);
    const key = `bid:${max}:${(st.bid.history || []).length}`;
    if (lastActionKey === key) return;
    lastActionKey = key;
    bidSent = true;
    console.log(`ACTION: bid ${max}`);
    fire('bid', { amount: max, pass: false });
    return;
  }

  if (st.phase === 'contract' && st.bid?.bidderIndex === st.viewerIndex && !contractSent) {
    const partnerCards = choosePartnerCards(st);
    if (partnerCards.length !== Number(st.partnerCount || 1)) return fail('could not choose partner card(s)');
    const trump = chooseTrump(st.hand || []);
    contractSent = true;
    lastActionKey = `contract:${trump}:${partnerCards.map(c => `${c.copy}-${c.suit}-${c.rank}`).join(',')}`;
    console.log(`ACTION: contract trump=${trump} partners=${partnerCards.map(c => `${c.rank}${c.suit}`).join(',')}`);
    fire('contract', { trump, partnerCards });
    return;
  }

  if (st.phase === 'playing' && !st.trickResolving && st.turnIndex === st.viewerIndex) {
    const legalIds = st.legalCardIds || [];
    if (!legalIds.length) return;
    const cardId = legalIds[0];
    const key = `play:${st.round}:${st.trickNumber}:${st.hand?.length}:${cardId}`;
    if (lastActionKey === key) return;
    lastActionKey = key;
    const card = (st.hand || []).find(c => c.id === cardId);
    console.log(`ACTION: play ${card ? `${card.rank}${card.suit}` : cardId}`);
    playCount++;
    fire('playCard', { cardId });
    return;
  }

  if (st.phase === 'roundEnd') {
    const rs = st.roundSummary || {};
    const total = Number(rs.bidderPoints || 0) + Number(rs.defensePoints || 0);
    const tricks = (st.trickHistory || []).length;
    const expectedTricks = Number(st.totalTricks || 13);
    const expectedPoints = Number(st.totalPoints || total);
    const summary = `room=${st.code} bid=${rs.bid ?? st.bid?.current} bidder=${rs.bidderPoints} defense=${rs.defensePoints} total=${total}/${expectedPoints} made=${rs.made} tricks=${tricks}/${expectedTricks} testerPlays=${playCount}`;
    if (!bidSent) return fail(`round ended without tester bidding: ${summary}`);
    if (!contractSent) return fail(`round ended without tester choosing contract: ${summary}`);
    if (tricks !== expectedTricks) return fail(`trick count mismatch: ${summary}`);
    if (total !== expectedPoints) return fail(`score total mismatch: ${summary}`);
    return ok(summary);
  }
}

const socket = io(SERVER, {path:'/socket.io',transports:['polling','websocket'],upgrade:true,timeout:60000,reconnection:true,reconnectionAttempts:8,reconnectionDelay:1500,reconnectionDelayMax:8000});

setInterval(() => {
  if (finished) return;
  const idle = Date.now() - lastProgressAt;
  if (roomCreated && idle > 45000) fail(`no authoritative state progress for ${Math.round(idle/1000)}s; phase=${latestState?.phase}; room=${roomCode}; states=${stateCount}; plays=${playCount}`);
}, 5000).unref?.();
setTimeout(() => fail(`overall timeout; lastPhase=${lastPhase}; states=${stateCount}; plays=${playCount}`), DEADLINE_MS).unref?.();

socket.on('connect', async () => {
  console.log(`CONNECTED: ${socket.id} -> ${SERVER}`);
  try {
    const res = await emitAck('createRoom', {name:'OpenAI QA',avatar:'🧪',playerCount:4,deckCount:1,isPublic:false,botDifficulty:'easy',botPersonality:'balanced',privatePin:'',turnTimeoutMs:15000,spectatorDelayMs:0,preset:'practice',seriesBestOf:1,teamMode:'random',tableTheme:'classic',voiceEnabled:false,spectatorsEnabled:false}, 30000);
    roomCode = res.code || '';
    roomCreated = true;
    lastProgressAt = Date.now();
    console.log(`ROOM_CREATED: ${roomCode}`);
    if (latestState) setTimeout(() => { try { actOnState(latestState); } catch (e) { fail(e.stack || e.message); } }, 50);
  } catch (e) { fail(e.message); }
});

socket.on('state', st => { stateCount++; try { actOnState(st); } catch (e) { fail(e.stack || e.message); } });
socket.on('connect_error', e => console.log(`CONNECT_ERROR: ${e.message}`));
socket.on('disconnect', reason => { if (!finished) console.log(`DISCONNECT: ${reason}`); });
socket.on('roomClosed', x => { if (!finished) fail(`room closed: ${JSON.stringify(x)}`); });
socket.on('kicked', x => { if (!finished) fail(`kicked: ${JSON.stringify(x)}`); });
