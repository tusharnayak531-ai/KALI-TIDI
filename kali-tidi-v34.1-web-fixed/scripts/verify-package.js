const fs=require('fs');const path=require('path');const root=path.resolve(__dirname,'..');
const must=['public/index.html','public/client.js','public/bootstrap.js','public/style.css','public/v34.css','public/v34.js','public/config.js','public/sw.js','public/manifest.webmanifest','public/icons/icon-192.png','public/icons/icon-512.png','server.js','render.yaml'];
let failed=false;for(const rel of must){if(!fs.existsSync(path.join(root,rel))){console.error(`MISSING: ${rel}`);failed=true;}}
if(fs.existsSync(path.join(root,'android'))){console.error('Android native package must not be included.');failed=true;}
const cfg=fs.readFileSync(path.join(root,'public/config.js'),'utf8');const m=cfg.match(/gameServer\s*:\s*["']([^"']+)/);if(!m||!m[1].startsWith('https://')){console.error('Fallback gameServer must be HTTPS.');failed=true;}else console.log(`Fallback backend: ${m[1]}`);
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');for(const asset of ['v34.css','bootstrap.js','manifest.webmanifest','icons/icon-192.png']){if(!html.includes(asset)){console.error(`index.html missing ${asset}`);failed=true;}}
const bootstrap=fs.readFileSync(path.join(root,'public/bootstrap.js'),'utf8');if(!bootstrap.includes('loadScript("v34.js")')){console.error('bootstrap.js does not load v34.js after client.js');failed=true;}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'public/manifest.webmanifest'),'utf8'));if(!Array.isArray(manifest.icons)||manifest.icons.length<2){console.error('PWA manifest icons missing');failed=true;}
if(failed)process.exit(1);console.log('V34 web package verification passed. Android package absent.');
