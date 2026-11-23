// node bake.js rigged.glb out.glb '{"LeftArm":["z",-40]}'  -> writes out.glb and out.glb.bones.json
const {chromium}=require('playwright');const http=require('http');const fs=require('fs');const path=require('path');
const [src,out,pose]=process.argv.slice(2);
const srv=http.createServer((q,s)=>{const p=path.join('.',decodeURIComponent(q.url.split('?')[0]));
 if(!fs.existsSync(p)){s.writeHead(404);return s.end();}
 const t={'.js':'text/javascript','.html':'text/html','.glb':'model/gltf-binary'}[path.extname(p)]||'application/octet-stream';
 s.writeHead(200,{'Content-Type':t});fs.createReadStream(p).pipe(s);}).listen(8767,async()=>{
 const b=await chromium.launch();const pg=await b.newPage();pg.on('pageerror',e=>console.log('ERR',e.message));
 await pg.goto('http://localhost:8767/pose.html');await pg.waitForFunction('window.ready');
 const r=await pg.evaluate(([u,p])=>window.bake(u,JSON.parse(p)),[src,pose]);
 fs.writeFileSync(out,Buffer.from(r.glb,'base64'));fs.writeFileSync(out+'.bones.json',JSON.stringify(r.bones));
 console.log('wrote',out);await b.close();srv.close();});
