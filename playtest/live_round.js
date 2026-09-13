const { io } = require('socket.io-client');

const SERVER = process.env.GAME_SERVER_URL || 'https://three-spades.onrender.com';
let latestState = null;
let roomCode = '';
let finished = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function stateBrief(st){
  const me = st?.players?.[st.viewerIndex];
  return {phase:st?.phase, ready:me?.ready, host:st?.host, players:st?.players?.length, readyCount:st?.readyCount};
}

function emitWithAck(event, ...args){
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(()=>{ if(!settled){ settled=true; resolve({timeout:true}); } }, 5000);
    const cb = res => { if(settled) return; settled=true; clearTimeout(timer); resolve(res ?? {ok:true}); };
    socket.emit(event, ...args, cb);
  });
}

async function waitState(pred, ms=3000){
  const end = Date.now()+ms;
  while(Date.now()<end){ if(pred(latestState)) return true; await sleep(100); }
  return false;
}

async function inspectLiveClient(){
  try{
    const r = await fetch(`${SERVER}/client.js`);
    const txt = await r.text();
    console.log(`LIVE_CLIENT status=${r.status} bytes=${txt.length}`);
    const hits = txt.split(/\r?\n/).filter(line => /toggleReady|setReady|playerReady|startGame|readyBtn|Mark Ready|Ready & Start/.test(line));
    console.log('LIVE_CLIENT_MATCHES_BEGIN');
    for(const line of hits.slice(0,60)) console.log(line.slice(0,1200));
    console.log('LIVE_CLIENT_MATCHES_END');
  }catch(e){ console.log('LIVE_CLIENT_FETCH_FAIL', e.message); }
}

async function tryAction(label, fn){
  console.log(`TRY ${label} before=${JSON.stringify(stateBrief(latestState))}`);
  let res;
  try{res = await fn();}catch(e){res={error:e.message};}
  console.log(`RESULT ${label} ack=${JSON.stringify(res)}`);
  const changed = await waitState(st => st && (st.phase !== 'lobby' || st.players?.[st.viewerIndex]?.ready === true), 2500);
  console.log(`STATE ${label} changed=${changed} after=${JSON.stringify(stateBrief(latestState))}`);
  return changed;
}

async function probeLobby(){
  await inspectLiveClient();
  await tryAction('startGame payload', ()=>emitWithAck('startGame', {}));
  if(latestState?.phase !== 'lobby') return;

  const candidates = [
    ['toggleReady payload', ()=>emitWithAck('toggleReady', {})],
    ['toggleReady true', ()=>emitWithAck('toggleReady', true)],
    ['toggleReady ready object', ()=>emitWithAck('toggleReady', {ready:true})],
    ['setReady', ()=>emitWithAck('setReady', {ready:true})],
    ['ready', ()=>emitWithAck('ready', {ready:true})],
    ['playerReady', ()=>emitWithAck('playerReady', {ready:true})]
  ];
  for(const [label, fn] of candidates){
    const changed = await tryAction(label, fn);
    if(latestState?.players?.[latestState.viewerIndex]?.ready || latestState?.phase !== 'lobby') break;
    if(changed) break;
  }

  if(latestState?.phase === 'lobby' && latestState?.players?.[latestState.viewerIndex]?.ready){
    await tryAction('startGame after ready payload', ()=>emitWithAck('startGame', {}));
    if(latestState?.phase === 'lobby') await tryAction('startGame no payload', ()=>new Promise(resolve=>{
      let done=false; const timer=setTimeout(()=>{if(!done){done=true;resolve({timeout:true});}},5000);
      socket.emit('startGame', res=>{if(done)return;done=true;clearTimeout(timer);resolve(res??{ok:true});});
    }));
  }

  console.log('PROBE_FINAL', JSON.stringify(stateBrief(latestState)));
  finished = true;
  try{ socket.emit('leaveRoom', {}); }catch{}
  socket.disconnect();
  setTimeout(()=>process.exit(0),200);
}

const socket = io(SERVER, {
  path:'/socket.io', transports:['polling','websocket'], upgrade:true, timeout:60000,
  reconnection:true, reconnectionAttempts:4, reconnectionDelay:1000
});

socket.onAny((event, ...args)=>{
  if(['state','connect','disconnect'].includes(event)) return;
  console.log(`EVENT ${event}`, JSON.stringify(args[0] ?? null).slice(0,1000));
});

socket.on('state', st=>{
  latestState = st;
  console.log('STATE_UPDATE', JSON.stringify(stateBrief(st)));
});

socket.on('connect', async ()=>{
  console.log(`CONNECTED ${socket.id}`);
  try{
    const res = await emitWithAck('createRoom', {
      name:'OpenAI QA', avatar:'🧪', playerCount:4, deckCount:1, isPublic:false,
      botDifficulty:'easy', botPersonality:'balanced', privatePin:'', turnTimeoutMs:15000,
      spectatorDelayMs:0, preset:'practice', seriesBestOf:1, teamMode:'random', tableTheme:'classic',
      voiceEnabled:false, spectatorsEnabled:false
    });
    console.log('CREATE_ACK', JSON.stringify(res));
    roomCode = res?.code || '';
    await waitState(st=>st?.phase==='lobby',5000);
    await probeLobby();
  }catch(e){ console.error('PROBE_FAIL', e); process.exit(1); }
});

socket.on('connect_error', e=>console.log('CONNECT_ERROR',e.message));
setTimeout(()=>{if(!finished){console.error('PROBE_TIMEOUT',roomCode,JSON.stringify(stateBrief(latestState)));process.exit(1);}},90000).unref?.();
