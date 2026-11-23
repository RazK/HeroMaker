const {chromium}=require('playwright');const http=require('http');const fs=require('fs');const path=require('path');
const root=process.argv[2], out=process.argv[3];
const srv=http.createServer((q,s)=>{const p=path.join(root,decodeURIComponent(q.url.split('?')[0]));
 if(!fs.existsSync(p)){s.writeHead(404);return s.end();}
 const t={'.js':'text/javascript','.html':'text/html','.glb':'model/gltf-binary'}[path.extname(p)]||'application/octet-stream';
 s.writeHead(200,{'Content-Type':t});fs.createReadStream(p).pipe(s);}).listen(8765,async()=>{
 const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const pg=await b.newPage({viewport:{width:900,height:1000}});
 pg.on('console',m=>console.log('console',m.text()));
 await pg.goto('http://localhost:8765/index.html');await pg.waitForFunction('window.ready',null,{timeout:120000});
 for(const [n,az,el,dist,ty] of [['front',0,8,330,52],['three_quarter',35,14,330,52],['back',180,10,330,52],['face',15,5,120,82]]){
  await pg.evaluate(([a,e,d,t])=>window.shot(a,e,d,t),[az,el,dist,ty]);await pg.locator('canvas').screenshot({path:`${out}/${n}.png`});}
 await b.close();srv.close();});
