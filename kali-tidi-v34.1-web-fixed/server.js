const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, 'public');
const gameServer = String(process.env.GAME_SERVER_URL || 'https://three-spades.onrender.com').replace(/\/$/, '');

app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy','same-origin-allow-popups');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self' https: wss:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});

// Runtime config lets Render/VPS deployments change backend without rebuilding the client.
app.get('/config.js',(_req,res)=>{
  res.type('application/javascript').set('Cache-Control','no-store').send(
    `window.KNT_CONFIG={gameServer:${JSON.stringify(gameServer)}};\nwindow.KNT_FEATURES={pushConfigured:false,cloudAccounts:true,ranked:true,tournaments:true,v34:true};\n`
  );
});

app.get('/health',(_req,res)=>res.json({ok:true,client:'web-v34.1',gameServer}));
app.get('/ready',(_req,res)=>res.json({ok:true,version:'3.4.1'}));
app.get('/api/runtime',(_req,res)=>res.json({version:'3.4.1',gameServer,pwa:true,proxy:true,redisConfigured:Boolean(process.env.REDIS_URL),databaseConfigured:Boolean(process.env.DATABASE_URL)}));

// Keep the browser same-origin and proxy real-time/game API traffic to the authoritative backend.
// Express strips the mount prefix from req.url, so add it back before proxying HTTP requests.
const socketProxy = createProxyMiddleware({
  target: gameServer,
  changeOrigin: true,
  ws: true,
  secure: true,
  xfwd: true,
  proxyTimeout: 65000,
  timeout: 65000
});
const apiProxy = createProxyMiddleware({
  target: gameServer,
  changeOrigin: true,
  secure: true,
  xfwd: true,
  proxyTimeout: 65000,
  timeout: 65000
});
app.use('/socket.io',(req,res,next)=>{ req.url='/socket.io'+req.url; return socketProxy(req,res,next); });
app.use('/api',(req,res,next)=>{ req.url='/api'+req.url; return apiProxy(req,res,next); });

app.use(express.static(publicDir,{extensions:['html'],maxAge:'1h',setHeaders:(res,file)=>{if(file.endsWith('sw.js')||file.endsWith('manifest.webmanifest')||file.endsWith('config.js'))res.setHeader('Cache-Control','no-cache');}}));
app.get('*',(_req,res)=>res.sendFile(path.join(publicDir,'index.html')));

const httpServer=app.listen(port,'0.0.0.0',()=>console.log(`Kaali Ni Tidi v34.1 web: http://127.0.0.1:${port} -> ${gameServer}`));
httpServer.on('upgrade',(req,socket,head)=>{
  if(req.url && req.url.startsWith('/socket.io/')) return socketProxy.upgrade(req,socket,head);
  socket.destroy();
});
