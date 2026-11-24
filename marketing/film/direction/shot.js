const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const D=process.argv[2];
for(const k of ['1','2','3','4','5','6','7']){const p=await b.newPage({viewport:{width:360,height:640},deviceScaleFactor:2});await p.goto('file://'+D+'/f'+k+'.html');await p.waitForTimeout(1200);await p.screenshot({path:D+'/f'+k+'.png'});await p.close()}await b.close()})()
