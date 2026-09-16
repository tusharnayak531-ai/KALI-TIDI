const { io } = require('socket.io-client');

const SERVER = process.env.GAME_SERVER_URL || 'https://three-spades.onrender.com';
const MODE = Number(process.env.PLAYER_MODE || 4);
const DEADLINE_MS = Number(process.env.PLAYTEST_TIMEOUT_MS || 330000);
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
const issues = [];

function brief(st){
  return {mode:MODE,phase:st?.phase,round:st?.round,players:st?.players?.length,turn:st?.turnIndex,bidTurn:st?.bid?.turnIndex,bid:st?.bid?.current,trick:st?.trickNumber,totalTricks:st?.totalTricks,hand:st?.hand?.length,totalPoints:st?.totalPoints,resolving:st?.trickResolving};
}
function addIssue(msg){if(!issues.includes(msg)){issues.push(msg);console.error(`ISSUE ${MODE}P: ${msg}`);}}
function finish(ok,msg){
  if(finished)return; finished=true;
  const prefix=ok?'PLAYTEST_PASS':'PLAYTEST_FAIL';
  console[ok?'log':'error'](`${prefix} ${MODE}P: ${msg}`);
  if(issues.length) console.error('ISSUES',JSON.stringify(issues));
  try{socket.emit('leaveRoom',{})}catch{}; try{socket.disconnect()}catch{};
  setTimeout(()=>process.exit(ok?0:1),250);
}
function fail(msg){finish(false,msg)}
function fire(event,payload={}){console.log(`ACTION ${MODE}P ${event}`,JSON.stringify(payload));socket.emit(event,payload,res=>{if(res?.ok===false)addIssue(`${event} rejected: ${res.error||'unknown'}`);});}
function chooseTrump(hand=[]){const c={S:0,H:0,D:0,C:0};for(const x of hand)if(x?.suit in c)c[x.suit]++;return Object.entries(c).sort((a,b)=>b[1]-a[1])[0]?.[0]||'S';}
function partnerChoices(st){
  if(Array.isArray(st.fixedPartnerOptionGroups)&&st.fixedPartnerOptionGroups.length)return st.fixedPartnerOptionGroups.map(g=>g?.[0]).filter(Boolean).slice(0,Number(st.partnerCount||1)).map(c=>({copy:Number(c.copy||1),suit:c.suit,rank:c.rank}));
  const owned=new Set((st.hand||[]).map(c=>c.id)),copies=Number(st.deckCount||1)===2?[1,2]:[1],ranks=(st.availableRanks||['2','3','4','5','6','7','8','9','10','J','Q','K','A']).slice().reverse(),out=[];
  for(const copy of copies)for(const suit of ['S','H','D','C'])for(const rank of ranks){const id=`${copy}-${suit}-${rank}`;if(!owned.has(id))out.push({copy,suit,rank,id});}
  return out.slice(0,Number(st.partnerCount||1)).map(c=>({copy:c.copy,suit:c.suit,rank:c.rank}));
}
function legalIds(st){if(Array.isArray(st.legalCardIds)&&st.legalCardIds.length)return st.legalCardIds;const hand=st.hand||[];if(!st.leadSuit)return hand.map(c=>c.id);const follow=hand.filter(c=>c.suit===st.leadSuit);return(follow.length?follow:hand).map(c=>c.id);}
function signature(st){const me=st?.players?.[st.viewerIndex];return[st?.phase,st?.round,st?.bid?.turnIndex,st?.bid?.current,st?.turnIndex,st?.trickNumber,st?.trickResolving,st?.hand?.length,me?.roundPoints].join('|');}
function checkInitialDeal(st){
  if(initialDealChecked||!['bidding','contract','playing'].includes(st.phase))return;initialDealChecked=true;
  if(st.players?.length!==MODE)addIssue(`expected ${MODE} players, got ${st.players?.length}`);
  if(Number(st.playerCount||MODE)!==MODE)addIssue(`state playerCount=${st.playerCount}`);
  if(Number(st.deckCount||EXPECTED.deckCount)!==EXPECTED.deckCount)addIssue(`expected ${EXPECTED.deckCount} deck(s), got ${st.deckCount}`);
  if((st.hand||[]).length!==EXPECTED.hand)addIssue(`expected ${EXPECTED.hand} cards in viewer hand, got ${(st.hand||[]).length}`);
  const ids=(st.hand||[]).map(c=>c.id);if(new Set(ids).size!==ids.length)addIssue('duplicate physical card id in viewer hand');
  if(Number(st.totalPoints||0)!==EXPECTED.points)addIssue(`expected totalPoints=${EXPECTED.points}, got ${st.totalPoints}`);
  if(Number(st.totalTricks||0)!==EXPECTED.tricks)addIssue(`expected totalTricks=${EXPECTED.tricks}, got ${st.totalTricks}`);
  console.log(`DEAL_AUDIT ${MODE}P`,JSON.stringify({hand:ids.length,totalPoints:st.totalPoints,totalTricks:st.totalTricks,partnerCount:st.partnerCount,ruleSummary:st.ruleSummary}));
}
function validateRoundEnd(st){
  const history=(st.trickHistory||[]).length,ledger=(st.roundSummary?.scoreLedger||st.scoreLedger||[]).length,trickNo=Number(st.trickNumber||0),tricks=Math.max(history,ledger,trickNo);
  const playerTotal=(st.players||[]).reduce((n,p)=>n+Number(p.roundPoints||0),0),rs=st.roundSummary||{},summaryTotal=Number(rs.bidderPoints||0)+Number(rs.defensePoints||0);
  console.log(`ROUND_AUDIT ${MODE}P`,JSON.stringify({trickNumber:trickNo,trickHistory:history,ledger,tricks,playerTotal,summaryTotal,totalPoints:st.totalPoints,totalTricks:st.totalTricks,bid:rs.bid??st.bid?.current,bidderPoints:rs.bidderPoints,defensePoints:rs.defensePoints,made:rs.made,mvpName:rs.mvpName,mvpPoints:rs.mvpPoints,integrity:st.integrity}));
  if(tricks!==EXPECTED.tricks)addIssue(`round completed ${tricks}/${EXPECTED.tricks} tricks`);
  if(playerTotal!==EXPECTED.points)addIssue(`player roundPoints total ${playerTotal}/${EXPECTED.points}`);
  if(summaryTotal&&summaryTotal!==EXPECTED.points)addIssue(`round summary total ${summaryTotal}/${EXPECTED.points}`);
  if(Number(st.totalPoints||0)!==EXPECTED.points)addIssue(`round-end totalPoints=${st.totalPoints}, expected ${EXPECTED.points}`);
  const target=Number(rs.bid??st.bid?.current??0),bidder=Number(rs.bidderPoints||0);
  if(target&&typeof rs.made==='boolean'&&rs.made!==(bidder>=target))addIssue(`made flag inconsistent: bid=${target}, bidder=${bidder}, made=${rs.made}`);
  const msg=`room=${st.code||roomCode} points=${playerTotal}/${EXPECTED.points} tricks=${tricks}/${EXPECTED.tricks} userPlays=${userPlays} passes=${passes} contracts=${contracts}`;
  finish(issues.length===0,msg+(issues.length?' issues='+issues.join('; '):''));
}
function act(st){
  if(finished||!st)return;latestState=st;stateCount++;const sig=signature(st);if(sig!==lastSignature){lastSignature=sig;lastProgressAt=Date.now();}
  if(st.phase!==lastPhase){lastPhase=st.phase;actionKey='';console.log(`PHASE ${MODE}P ${st.phase}`,JSON.stringify(brief(st)));}
  if(!roomCreated)return;const me=st.players?.[st.viewerIndex];if(!me&&!st.spectator)return fail('viewer player missing from state');
  if(st.phase==='lobby'&&st.host&&!started){started=true;fire('startGame',{});return;}
  checkInitialDeal(st);
  if(st.phase==='bidding'&&st.bid?.turnIndex===st.viewerIndex){const key=`bid:${st.round}:${(st.bid?.history||[]).length}:${st.bid?.current}`;if(actionKey===key)return;actionKey=key;passes++;fire('bid',{pass:true});return;}
  if(st.phase==='contract'&&st.bid?.bidderIndex===st.viewerIndex){const picks=partnerChoices(st),need=Number(st.partnerCount||1);if(picks.length!==need)return fail(`could not choose ${need} partner card(s); got ${picks.length}`);const key=`contract:${st.round}:${st.bid?.current}`;if(actionKey===key)return;actionKey=key;contracts++;fire('contract',{trump:chooseTrump(st.hand||[]),partnerCards:picks});return;}
  if(st.phase==='playing'&&!st.trickResolving&&st.turnIndex===st.viewerIndex){const ids=legalIds(st);if(!ids.length)return fail('viewer turn has no legal card');const cardId=ids[0],key=`play:${st.round}:${st.trickNumber}:${st.hand?.length}:${cardId}`;if(actionKey===key)return;actionKey=key;userPlays++;fire('playCard',{cardId});return;}
  if(st.phase==='roundEnd')validateRoundEnd(st);
}

const socket=io(SERVER,{path:'/socket.io',transports:['polling','websocket'],upgrade:true,timeout:60000,reconnection:true,reconnectionAttempts:8,reconnectionDelay:1000,reconnectionDelayMax:5000});
socket.on('connect',()=>{console.log(`CONNECTED ${MODE}P ${socket.id} -> ${SERVER}`);socket.emit('createRoom',{name:`QA ${MODE}P`,avatar:'🧪',playerCount:MODE,deckCount:EXPECTED.deckCount,isPublic:false,botDifficulty:'easy',botPersonality:'balanced',privatePin:'',turnTimeoutMs:15000,spectatorDelayMs:0,preset:'practice',seriesBestOf:1,teamMode:'random',tableTheme:'classic',voiceEnabled:false,spectatorsEnabled:false},res=>{if(res?.ok===false)return fail(`createRoom rejected: ${res.error||'unknown'}`);roomCode=res?.code||'';roomCreated=true;lastProgressAt=Date.now();console.log(`ROOM_CREATED ${MODE}P ${roomCode}`);if(latestState)setTimeout(()=>act(latestState),50);});});
socket.on('state',st=>{try{act(st)}catch(e){fail(e.stack||e.message)}});socket.on('connect_error',e=>console.log(`CONNECT_ERROR ${MODE}P ${e.message}`));socket.on('roomClosed',x=>fail(`room closed: ${JSON.stringify(x)}`));socket.on('kicked',x=>fail(`kicked: ${JSON.stringify(x)}`));
setInterval(()=>{if(finished||!roomCreated)return;const idle=Date.now()-lastProgressAt;if(idle>60000)fail(`no authoritative progress for ${Math.round(idle/1000)}s; states=${stateCount}`);},5000).unref?.();
setTimeout(()=>fail(`overall timeout after ${DEADLINE_MS}ms; states=${stateCount}`),DEADLINE_MS).unref?.();
