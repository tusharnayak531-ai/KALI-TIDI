'use strict';
const http=require('http'), crypto=require('crypto'), fs=require('fs'), path=require('path');
const rooms=new Map(), port=Number(process.env.PORT||3000);
const newToken=()=>crypto.randomBytes(24).toString('hex');
const code=()=>crypto.randomBytes(3).toString('hex').toUpperCase();
const bad=(m)=>{throw new Error(m)};
const reply=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
const notify=r=>{r.updated=Date.now();r.version++;for(const c of r.clients)try{c.write('data: '+r.version+'\n\n')}catch(e){r.clients.delete(c)}};
const next=(r,i)=>(i+1)%r.players.length;
const check=(d)=>{const r=rooms.get(String(d.code||'').toUpperCase());if(!r)bad('Room not found');const p=r.players.find(p=>p.token===d.token);if(!p)bad('You are not in this room');return {r,p}};
function makePlayer(name){return {id:newToken().slice(0,12),token:newToken(),name:String(name||'Player').replace(/[\x00-\x1f<>]/g,'').trim().slice(0,26)||'Player',points:0,bid:null,won:0,hand:[],gain:0}}
function makeDeck(total){const deck=[];for(let d=0;d<Math.ceil(total/52);d++)for(let s=0;s<4;s++)for(let n=2;n<15;n++)deck.push({id:d+'_'+s+'_'+n,s,n});for(let i=deck.length-1;i>0;i--){const j=crypto.randomInt(i+1);[deck[i],deck[j]]=[deck[j],deck[i]]}return deck}
function startRound(r){r.round++;r.count=r.round;r.trump=(r.round-1)%4;r.dealer=(r.round-1)%r.players.length;r.turn=next(r,r.dealer);r.stage='bid';r.trick=[];r.last=null;r.winner=null;r.done=0;const deck=makeDeck(r.count*r.players.length);for(const p of r.players){p.bid=null;p.won=0;p.gain=0;p.hand=deck.splice(0,r.count)};notify(r)}
function best(a,b,lead,trump){if(a.s===b.s)return a.n>b.n;if(a.s===trump)return true;if(b.s===trump)return false;return a.s===lead&&b.s!==lead}
function action(r,p,d){
 if(d.type==='start'){if(p.id!==r.host)bad('Host only');if(!['lobby','finished'].includes(r.stage))bad('Match already started');if(r.players.length<2)bad('Invite at least 2 players');r.max=r.players.length<=52?Math.min(13,Math.floor(52/r.players.length)):1;r.round=0;for(const x of r.players)x.points=0;return startRound(r)}
 if(d.type==='next'){if(p.id!==r.host||r.stage!=='end')bad('Host must wait until round ends');return startRound(r)}
 if(d.type==='bid'){if(r.stage!=='bid'||r.players[r.turn].id!==p.id)bad('Not your bidding turn');const v=Number(d.bid);if(!Number.isInteger(v)||v<0||v>r.count)bad('Invalid bid');if(r.turn===r.dealer&&r.players.reduce((s,x)=>s+(x.bid||0),v)===r.count)bad('Dealer cannot make total bids equal tricks');p.bid=v;if(r.turn===r.dealer){r.stage='play';r.turn=next(r,r.dealer)}else r.turn=next(r,r.turn);return notify(r)}
 if(d.type==='play'){if(r.stage!=='play'||r.players[r.turn].id!==p.id)bad('Not your turn to play');const i=p.hand.findIndex(c=>c.id===d.card);if(i<0)bad('Card not in hand');if(r.winner){r.trick=[];r.winner=null}const c=p.hand[i];if(r.trick.length&&c.s!==r.trick[0].card.s&&p.hand.some(x=>x.s===r.trick[0].card.s))bad('You must follow suit');p.hand.splice(i,1);r.trick.push({player:p.id,card:c});if(r.trick.length===r.players.length){let w=r.trick[0];const lead=w.card.s;for(const x of r.trick.slice(1))if(best(x.card,w.card,lead,r.trump))w=x;r.winner=w.player;r.last={cards:r.trick.map(x=>({...x})),winner:w.player,round:r.round,trick:r.done+1};r.players.find(x=>x.id===w.player).won++;r.done++;r.turn=r.players.findIndex(x=>x.id===w.player);if(r.done===r.count){for(const x of r.players){x.gain=x.won===x.bid?10+x.bid:0;x.points+=x.gain}r.stage=r.round===r.max?'finished':'end'}}else r.turn=next(r,r.turn);return notify(r)}
 bad('Unknown action')
}
function publicState(r,p){return {code:r.code,version:r.version,phase:r.stage,players:r.players.map(x=>({id:x.id,name:x.name,points:x.points,bid:x.bid,won:x.won,gain:x.gain,cards:x.hand.length})),me:p.id,host:r.host,round:r.round,max:r.max,count:r.count,trump:r.trump,turn:r.players[r.turn]?.id,hand:p.hand,trick:r.trick,last:r.last,winner:r.winner,done:r.done,dealer:r.players[r.dealer]?.id,forbidden:r.stage==='bid'&&r.turn===r.dealer?r.count-r.players.reduce((v,x)=>v+(x.bid||0),0):null}}
const page=fs.readFileSync(path.join(__dirname,'index.html'));
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-cache'});return res.end(page)}
 if(req.method==='GET'&&url.pathname==='/health')return reply(res,200,{ok:true,rooms:rooms.size});
 if(req.method==='GET'&&url.pathname==='/api/state')try{const {r,p}=check(Object.fromEntries(url.searchParams));return reply(res,200,publicState(r,p))}catch(e){return reply(res,400,{error:e.message})}
 if(req.method==='GET'&&url.pathname==='/api/events')try{const {r}=check(Object.fromEntries(url.searchParams));res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});r.clients.add(res);res.write('data: '+r.version+'\n\n');const h=setInterval(()=>res.write(': ping\n\n'),20000);req.on('close',()=>{clearInterval(h);r.clients.delete(res)});return}catch(e){return reply(res,400,{error:e.message})}
 if(req.method==='POST'&&url.pathname.startsWith('/api/')){
 let body='';try{for await(const chunk of req){body+=chunk;if(body.length>12000)bad('Request too large')}const d=JSON.parse(body||'{}');
 if(url.pathname==='/api/create'){const p=makePlayer(d.name),r={code:code(),players:[p],host:p.id,clients:new Set(),version:0,stage:'lobby',round:0,max:0,count:0,trump:0,turn:0,dealer:0,trick:[],last:null,done:0,winner:null,updated:Date.now()};while(rooms.has(r.code))r.code=code();rooms.set(r.code,r);return reply(res,200,{code:r.code,token:p.token})}
 if(url.pathname==='/api/join'){const r=rooms.get(String(d.code||'').toUpperCase());if(!r)bad('Room code not found');const saved=r.players.find(p=>p.token===d.token);if(saved)return reply(res,200,{code:r.code,token:saved.token});if(r.stage!=='lobby')bad('Match already started');const p=makePlayer(d.name);r.players.push(p);notify(r);return reply(res,200,{code:r.code,token:p.token})}
 if(url.pathname==='/api/action'){const {r,p}=check(d);action(r,p,d);return reply(res,200,{ok:true})}
 }catch(e){return reply(res,400,{error:e.message})}
 }
 return reply(res,404,{error:'Not found'})
});
server.listen(port,'0.0.0.0',()=>console.log('Kachuful flexible rooms ready on',port));
setInterval(()=>{for(const [id,r] of rooms)if(Date.now()-r.updated>24*60*60*1000){for(const c of r.clients)c.end();rooms.delete(id)}},600000).unref();
