const CACHE='knt-v34-shell-v1';
const CORE=['/','/index.html','/style.css','/v34.css','/client.js','/v34.js','/bootstrap.js','/config.js','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(async keys=>{const hadOld=keys.some(k=>k.startsWith('knt-')&&k!==CACHE);await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim();if(hadOld){const clients=await self.clients.matchAll({type:'window'});clients.forEach(c=>c.postMessage({type:'KNT_UPDATE_READY'}));}}));});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.pathname.startsWith('/socket.io/')||url.pathname.startsWith('/api/')||url.origin!==self.location.origin)return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put('/index.html',copy));return res;}).catch(()=>caches.match('/index.html')));return;
  }
  event.respondWith(caches.match(req).then(cached=>{const fresh=fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));}return res;}).catch(()=>cached);return cached||fresh;}));
});
