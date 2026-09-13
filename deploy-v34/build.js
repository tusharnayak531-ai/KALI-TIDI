const fs=require('fs');
const path=require('path');
const BASE=String(process.env.BASE_CLIENT_URL||process.env.GAME_SERVER_URL||'https://three-spades.onrender.com').replace(/\/$/,'');
const out=path.join(__dirname,'public');
fs.mkdirSync(out,{recursive:true});
fs.mkdirSync(path.join(out,'icons'),{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function grab(name){
  let err;
  for(let i=0;i<8;i++){
    try{
      const r=await fetch(`${BASE}/${name}`,{headers:{'user-agent':'KNT-V34-Render-Builder'}});
      if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
      const b=Buffer.from(await r.arrayBuffer());
      if(!b.length)throw new Error('empty response');
      fs.writeFileSync(path.join(out,name),b);
      console.log('downloaded',name,b.length);
      return;
    }catch(e){err=e;console.log('retry',name,i+1,String(e));await sleep(5000);}
  }
  throw err;
}
(async()=>{
  for(const f of ['index.html','style.css','client.js','bootstrap.js','admin.html','admin.js']) await grab(f);
  let html=fs.readFileSync(path.join(out,'index.html'),'utf8');
  html=html.replace('width=device-width, initial-scale=1.0','width=device-width, initial-scale=1.0, viewport-fit=cover');
  if(!html.includes('apple-mobile-web-app-capable')) html=html.replace('<meta name="theme-color" content="#071e17" />','<meta name="theme-color" content="#071e17" />\n  <meta name="apple-mobile-web-app-capable" content="yes" />\n  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />\n  <meta name="apple-mobile-web-app-title" content="Kaali Ni Tidi" />');
  if(!html.includes('apple-touch-icon')) html=html.replace('<link rel="manifest" href="manifest.webmanifest" />','<link rel="manifest" href="manifest.webmanifest" />\n  <link rel="apple-touch-icon" href="icons/icon.svg" />');
  if(!html.includes('v34.css')) html=html.replace('<link rel="stylesheet" href="style.css" />','<link rel="stylesheet" href="style.css" />\n  <link rel="stylesheet" href="v34.css" />');
  html=html.replace('Kaali Ni Tidi v3.3 Ultimate','Kaali Ni Tidi v3.4 Premium Web');
  fs.writeFileSync(path.join(out,'index.html'),html);

  let boot=fs.readFileSync(path.join(out,'bootstrap.js'),'utf8');
  if(!boot.includes('v34.js')) boot=boot.replace('await loadScript("client.js");','await loadScript("client.js");\n    await loadScript("v34.js");');
  fs.writeFileSync(path.join(out,'bootstrap.js'),boot);

  let client=fs.readFileSync(path.join(out,'client.js'),'utf8');
  client=client.replace('const KNT_CLIENT_VERSION="3.3.0";','const KNT_CLIENT_VERSION="3.4.0";');
  client=client.replace('Version 3.3 combines 3–8 player custom rules, secure server-authoritative play, live voice, ranked seasons, tournaments, replays, series, achievements, missions and fair-play receipts.','Version 3.4 keeps the server-authoritative multiplayer platform and adds stronger PWA reliability, mobile gestures, connection diagnostics, automatic weak-network tuning and smart turn coaching.');
  fs.writeFileSync(path.join(out,'client.js'),client);

  const manifest={id:'/',name:'Kaali Ni Tidi — 3 of Spades',short_name:'Kaali Ni Tidi',start_url:'/',scope:'/',display:'standalone',display_override:['window-controls-overlay','standalone','browser'],orientation:'any',background_color:'#04150f',theme_color:'#071e17',description:'Premium online multiplayer Kaali Ni Tidi card game.',categories:['games','entertainment'],icons:[{src:'/icons/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}],shortcuts:[{name:'Play',short_name:'Play',url:'/?tab=play'},{name:'Competitive',short_name:'Ranked',url:'/?tab=competitive'}]};
  fs.writeFileSync(path.join(out,'manifest.webmanifest'),JSON.stringify(manifest,null,2));
  fs.writeFileSync(path.join(out,'icons','icon.svg'),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#04150f"/><circle cx="256" cy="256" r="190" fill="#0a3428" stroke="#edc86b" stroke-width="18"/><text x="256" y="318" text-anchor="middle" font-family="Georgia,serif" font-size="220" font-weight="700" fill="#edc86b">3♠</text></svg>`);
  fs.writeFileSync(path.join(out,'sw.js'),`const CACHE='knt-v34-shell-v2';const CORE=['/','/index.html','/style.css','/v34.css','/client.js','/v34.js','/bootstrap.js','/config.js','/manifest.webmanifest','/icons/icon.svg'];self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(async k=>{await Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)));await self.clients.claim();})));self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting();});self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.pathname.startsWith('/socket.io/')||u.pathname.startsWith('/api/')||u.origin!==self.location.origin)return;if(r.mode==='navigate'){e.respondWith(fetch(r).then(x=>{const y=x.clone();caches.open(CACHE).then(c=>c.put('/index.html',y));return x;}).catch(()=>caches.match('/index.html')));return;}e.respondWith(caches.match(r).then(cached=>{const fresh=fetch(r).then(x=>{if(x.ok){const y=x.clone();caches.open(CACHE).then(c=>c.put(r,y));}return x;}).catch(()=>cached);return cached||fresh;}));});`);
  for(const required of ['index.html','style.css','client.js','bootstrap.js','v34.js','v34.css']) if(!fs.existsSync(path.join(out,required))) throw new Error('missing '+required);
  console.log('V34 web assets ready');
})().catch(e=>{console.error(e);process.exit(1);});
