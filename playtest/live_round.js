const { io } = require('socket.io-client');

const SERVER = process.env.GAME_SERVER_URL || 'https://three-spades.onrender.com';
const MODE = Number(process.env.PLAYER_MODE || 4);
const DEADLINE_MS = Number(process.env.PLAYTEST_TIMEOUT_MS || 300000);
const EXPECTED = {
  4: { deckCount: 1, hand: 13, tricks: 13, points: 250 },
  6: { deckCount: 2, hand: 17, tricks: 17, points: 500 },
  8: { deckCount: 2, hand: 13, tricks: 13, points: 500 }
}[MODE];
if (!EXPECTED) throw new Error(`Unsupported PLAYER_MODE ${MODE}`);

let latestState = null;
let roomCode = '';
let finished = false;
let roomCreated = false;
let started = false;
let initialDealChecked = false;
let actionKey = '';
let stateCount = 0;
let userPlays = 0;
let passes = 0;
let contracts = 0;
let lastPhase = '';
let lastProgressAt = Date.now();
let lastSignature = '';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function brief(st){
  return {
    mode: MODE, phase: st?.phase, round: st?.round, players: st?.players?.length,
    turn: st?.turnIndex, bidTurn: st?.bid?.turnIndex, bid: st?.bid?.current,
    trick: st?.trickNumber, hand: st?.hand?.length, resolving: st?.trickResolving
  };
}
function fail(msg){
  if (finished) return;
  finished = true;
  console.error(`PLAYTEST_FAIL ${MODE}P: ${msg}`);
  console.error('LAST_STATE', JSON.stringify(brief(latestState)));
  try { socket.emit('leaveRoom', {}); } catch {}
  try { socket.disconnect(); } catch {}
  setTimeout(()=>process.exit(1),250);
}
function pass(msg){
  if (finished) return;
  finished = true;
  console.log(`PLAYTEST_PASS ${MODE}P: ${msg}`);
  try { socket.emit('leaveRoom', {}); } catch {}
  try { socket.disconnect(); } catch {}
  setTimeout(()=>process.exit(0),250);
}
function fire(event, payload = {}){
  console.log(`ACTION ${MODE}P ${event}`, JSON.stringify(payload));
  socket.emit(event, payload, res => {
    if (res?.ok === false) console.log(`ACK_REJECTED ${event}: ${res.error || 'rejected'}`);
  });
}
function chooseTrump(hand=[]){
  const count={S:0,H:0,D:0,C:0};
  for(const c of hand) if(c?.suit in count) count[c.suit]++;
  return Object.entries(count).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'S';
}
function partnerChoices(st){
  if (Array.isArray(st.fixedPartnerOptionGroups) && st.fixedPartnerOptionGroups.length) {
    return st.fixedPartnerOptionGroups.map(group => group?.[0]).filter(Boolean).slice(0, Number(st.partnerCount||1)).map(c=>({copy:Number(c.copy||1),suit:c.suit,rank:c.rank}));
  }
  const owned=new Set((st.hand||[]).map(c=>c.id));
  const copies=Number(st.deckCount||1)===2?[1,2]:[1];
  const ranks=(st.availableRanks||['2','3','4','5','6','7','8','9','10','J','Q','K','A']).slice().reverse();
  const out=[];
  for(const copy of copies) for(const suit of ['S','H','D','C']) for(const rank of ranks){
    const id=`${copy}-${suit}-${rank}`;
    if(!owned.has(id)) out.push({copy,suit,rank,id});
  }
  const used=new Set(), picks=[];
  for(const c of out){
    if(used.has(c.id)) continue;
    used.add(c.id); picks.push({copy:c.copy,suit:c.suit,rank:c.rank});
    if(picks.length>=Number(st.partnerCount||1)) break;
  }
  return picks;
}
function legalIds(st){
  if(Array.isArray(st.legalCardIds)&&st.legalCardIds.length) return st.legalCardIds;
  const hand=st.hand||[];
  if(!st.leadSuit) return hand.map(c=>c.id);
  const follow=hand.filter(c=>c.suit===st.leadSuit);
  return (follow.length?follow:hand).map(c=>c.id);
}
function signature(st){
  const me=st?.players?.[st.viewerIndex];
  return [st?.phase,st?.round,st?.bid?.turnIndex,st?.bid?.current,st?.turnIndex,st?.trickNumber,st?.trickResolving,st?.hand?.length,me?.roundPoints,(st?.trickHistory||[]).length].join('|');
}
function checkInitialDeal(st){
  if(initialDealChecked || !['bidding','contract','playing'].includes(st.phase)) return;
  initialDealChecked=true;
  if(st.players?.length!==MODE) return fail(`expected ${MODE} players, got ${st.players?.length}`);
  if(Number(st.playerCount||MODE)!==MODE) return fail(`state playerCount=${st.playerCount}`);
  if(Number(st.deckCount||EXPECTED.deckCount)!==EXPECTED.deckCount) return fail(`expected ${EXPECTED.deckCount} deck(s), got ${st.deckCount}`);
  if((st.hand||[]).length!==EXPECTED.hand) return fail(`expected ${EXPECTED.hand} cards in viewer hand, got ${(st.hand||[]).length}`);
  const ids=(st.hand||[]).map(c=>c.id);
  if(new Set(ids).size!==ids.length) return fail('duplicate physical card id in viewer hand');
  if(Number(st.totalPoints||EXPECTED.points)!==EXPECTED.points) return fail(`expected ${EXPECTED.points} total points, got ${st.totalPoints}`);
  if(Number(st.totalTricks||EXPECTED.tricks)!==EXPECTED.tricks) return fail(`expected ${EXPECTED.tricks} tricks, got ${st.totalTricks}`);
  console.log(`DEAL_OK ${MODE}P hand=${ids.length} totalPoints=${st.totalPoints} totalTricks=${st.totalTricks}`);
}
function validateRoundEnd(st){
  const tricks=(st.trickHistory||[]).length;
  const playerTotal=(st.players||[]).reduce((n,p)=>n+Number(p.roundPoints||0),0);
  const rs=st.roundSummary||{};
  const summaryTotal=Number(rs.bidderPoints||0)+Number(rs.defensePoints||0);
  if(tricks!==EXPECTED.tricks) return fail(`round ended with ${tricks}/${EXPECTED.tricks} tricks`);
  if(playerTotal!==EXPECTED.points) return fail(`player roundPoints total ${playerTotal}/${EXPECTED.points}`);
  if(summaryTotal && summaryTotal!==EXPECTED.points) return fail(`round summary total ${summaryTotal}/${EXPECTED.points}`);
  if(Number(st.totalPoints||EXPECTED.points)!==EXPECTED.points) return fail(`state totalPoints changed to ${st.totalPoints}`);
  const target=Number(rs.bid ?? st.bid?.current ?? 0);
  const bidder=Number(rs.bidderPoints||0);
  const defense=Number(rs.defensePoints||0);
  if(target && typeof rs.made==='boolean' && rs.made!==(bidder>=target)) return fail(`made flag inconsistent: bid=${target} bidder=${bidder} made=${rs.made}`);
  pass(`room=${st.code||roomCode} bid=${target} bidder=${bidder} defense=${defense} points=${playerTotal}/${EXPECTED.points} tricks=${tricks}/${EXPECTED.tricks} userPlays=${userPlays} passes=${passes} contracts=${contracts}`);
}

function act(st){
  if(finished || !st) return;
  latestState=st; stateCount++;
  const sig=signature(st);
  if(sig!==lastSignature){ lastSignature=sig; lastProgressAt=Date.now(); }
  if(st.phase!==lastPhase){ lastPhase=st.phase; actionKey=''; console.log(`PHASE ${MODE}P ${st.phase}`, JSON.stringify(brief(st))); }
  if(!roomCreated) return;
  const me=st.players?.[st.viewerIndex];
  if(!me && !st.spectator) return fail('viewer player missing from state');

  if(st.phase==='lobby' && st.host && !started){
    started=true;
    fire('startGame',{});
    return;
  }
  checkInitialDeal(st);
  if(finished) return;

  if(st.phase==='bidding' && st.bid?.turnIndex===st.viewerIndex){
    const key=`bid:${st.round}:${(st.bid?.history||[]).length}:${st.bid?.current}`;
    if(actionKey===key) return; actionKey=key; passes++;
    fire('bid',{pass:true});
    return;
  }
  if(st.phase==='contract' && st.bid?.bidderIndex===st.viewerIndex){
    const picks=partnerChoices(st);
    const need=Number(st.partnerCount||1);
    if(picks.length!==need) return fail(`could not choose ${need} partner card(s); got ${picks.length}`);
    const key=`contract:${st.round}:${st.bid?.current}`;
    if(actionKey===key) return; actionKey=key; contracts++;
    fire('contract',{trump:chooseTrump(st.hand||[]),partnerCards:picks});
    return;
  }
  if(st.phase==='playing' && !st.trickResolving && st.turnIndex===st.viewerIndex){
    const ids=legalIds(st);
    if(!ids.length) return fail('viewer turn has no legal card');
    const cardId=ids[0];
    const key=`play:${st.round}:${st.trickNumber}:${st.hand?.length}:${cardId}`;
    if(actionKey===key) return; actionKey=key; userPlays++;
    fire('playCard',{cardId});
    return;
  }
  if(st.phase==='roundEnd') validateRoundEnd(st);
}

const socket=io(SERVER,{path:'/socket.io',transports:['polling','websocket'],upgrade:true,timeout:60000,reconnection:true,reconnectionAttempts:8,reconnectionDelay:1000,reconnectionDelayMax:5000});

socket.on('connect',()=>{
  console.log(`CONNECTED ${MODE}P ${socket.id} -> ${SERVER}`);
  socket.emit('createRoom',{
    name:`QA ${MODE}P`,avatar:'🧪',playerCount:MODE,deckCount:EXPECTED.deckCount,isPublic:false,
    botDifficulty:'easy',botPersonality:'balanced',privatePin:'',turnTimeoutMs:15000,spectatorDelayMs:0,
    preset:'practice',seriesBestOf:1,teamMode:'random',tableTheme:'classic',voiceEnabled:false,spectatorsEnabled:false
  },res=>{
    if(res?.ok===false) return fail(`createRoom rejected: ${res.error||'unknown'}`);
    roomCode=res?.code||''; roomCreated=true; lastProgressAt=Date.now();
    console.log(`ROOM_CREATED ${MODE}P ${roomCode}`);
    if(latestState) setTimeout(()=>act(latestState),50);
  });
});
socket.on('state',st=>{try{act(st);}catch(e){fail(e.stack||e.message);}});
socket.on('connect_error',e=>console.log(`CONNECT_ERROR ${MODE}P ${e.message}`));
socket.on('roomClosed',x=>fail(`room closed: ${JSON.stringify(x)}`));
socket.on('kicked',x=>fail(`kicked: ${JSON.stringify(x)}`));

setInterval(()=>{
  if(finished||!roomCreated) return;
  const idle=Date.now()-lastProgressAt;
  if(idle>60000) fail(`no authoritative progress for ${Math.round(idle/1000)}s; states=${stateCount}`);
},5000).unref?.();
setTimeout(()=>fail(`overall timeout after ${DEADLINE_MS}ms; states=${stateCount}`),DEADLINE_MS).unref?.();
