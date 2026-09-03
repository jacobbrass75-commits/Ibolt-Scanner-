import http from 'node:http';
import QRCode from 'qrcode';
import { mkdir, writeFile } from 'node:fs/promises';

const samples = [
  {code:'21164',title:'Part number',detail:'Plastic 17mm AMPS plate'},
  {code:'8585770068396',title:'Product barcode',detail:'Camera screw mount adapter'},
  {code:'00012345',title:'Leading zeros',detail:'Test value; not an inventory item'},
];
await mkdir('private/scanner-test',{recursive:true});
const cards = await Promise.all(samples.map(async (sample,i) => {
  const options={errorCorrectionLevel:'M',margin:4,width:360,color:{dark:'#000000',light:'#ffffff'}};
  await QRCode.toFile(`private/scanner-test/qr-${i+1}.png`,sample.code,options);
  const qr = await QRCode.toString(sample.code,{...options,type:'svg'});
  return `<article><h2>${sample.title}</h2><div class="qr">${qr}</div><strong>${sample.code}</strong><p>${sample.detail}</p></article>`;
}));
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>iBolt USB scanner test</title><style>
*{box-sizing:border-box}body{margin:0;background:#eef3f6;color:#152e3b;font:16px system-ui,sans-serif}main{max-width:1140px;margin:auto;padding:24px}h1{font-size:30px;margin:0 0 8px}p{line-height:1.5}header p{margin:0 0 20px}.capture{position:sticky;top:0;z-index:1;background:white;padding:18px;border:2px solid #176a77;border-radius:14px;box-shadow:0 5px 20px #152e3b15}label{font-weight:700;display:block;margin-bottom:8px}.entry{display:flex;gap:10px}input{font:24px ui-monospace,monospace;min-width:0;flex:1;padding:12px;border:2px solid #668994;border-radius:8px}input:focus{outline:3px solid #56c6d9;outline-offset:2px}button{font:600 16px system-ui;padding:12px 18px;background:#176a77;color:white;border:0;border-radius:8px;cursor:pointer}#result{font-size:18px;font-weight:650;margin:12px 0 0;min-height:27px}.ready{color:#176a77}.pass{color:#167647}.fail{color:#a23d15}#details{font-size:14px;color:#53616e;margin:6px 0 0}.codes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin:22px 0}article{background:white;border:1px solid #cfdae0;border-radius:14px;text-align:center;padding:18px 12px}h2{font-size:17px;margin:0 0 6px}.qr{max-width:290px;margin:auto}.qr svg{display:block;width:100%;height:auto}article strong{font:700 22px ui-monospace,monospace;letter-spacing:1px}article p{font-size:14px;margin:8px 0 0}footer{font-size:14px;color:#53616e}.small{background:#e0eaef;color:#152e3b;margin-left:8px}@media(max-width:720px){main{padding:16px}.codes{grid-template-columns:1fr}.qr{max-width:300px}.capture{position:static}h1{font-size:24px}input{font-size:20px}article{padding:12px}}@media print{body{background:white}.capture,.actions,footer{display:none}main{padding:0}.codes{grid-template-columns:repeat(3,1fr)}article{break-inside:avoid}.qr{max-width:220px}}
</style></head><body><main><header><h1>Test your USB scanner</h1><p>Click the input below, point at a QR code, and pull the trigger. A successful scan turns the result green.</p></header><section class="capture"><label for="scan">Scanner input</label><div class="entry"><input id="scan" type="text" autofocus autocomplete="off" spellcheck="false" placeholder="Click here, then scan a code"><button id="check">Check scan</button></div><p id="result" class="ready" role="status" aria-live="polite">Ready — scan any code below</p><p id="details">Use USB keyboard / HID mode. Enter or Tab finishes a scan; otherwise click Check scan.</p></section><section class="codes">${cards.join('')}</section><div class="actions"><button id="print">Print QR sheet</button><button id="clear" class="small">Clear results</button></div><footer><p>This test only checks what your scanner types. It does not connect to or change inventory. Leading zeros should remain intact. A scanner must support 2D/QR codes to read these labels.</p></footer></main><script>
const samples=${JSON.stringify(samples)};const input=document.getElementById('scan'),result=document.getElementById('result'),details=document.getElementById('details');let count=0;
function check(suffix){const raw=input.value;if(!raw)return;const code=raw.trim().replace(/^\\][A-Za-z][0-9]/,'');const match=samples.find(s=>s.code===code);count++;result.className=match?'pass':'fail';result.textContent=match?'✓ Scanner received '+code:'Received a different value: '+raw;details.textContent='Scan '+count+' · '+raw.length+' characters · Finished by '+suffix+(match?' · Exact test value matched':' · Compare this with the number under the QR code');input.value='';input.focus();}
input.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();check(event.key)}});document.getElementById('check').addEventListener('click',()=>check('button'));document.getElementById('print').addEventListener('click',()=>window.print());document.getElementById('clear').addEventListener('click',()=>{count=0;input.value='';result.className='ready';result.textContent='Ready — scan any code below';details.textContent='Use USB keyboard / HID mode. Enter or Tab finishes a scan; otherwise click Check scan.';input.focus()});
</script></body></html>`;
await writeFile('private/scanner-test/Scanner Test.html',html);
const server=http.createServer((request,response)=>{
  if(request.method!=='GET'||request.url!=='/'){response.writeHead(404).end();return;}
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});response.end(html);
});
server.listen(5015,'127.0.0.1',()=>console.log('USB scanner test ready at http://localhost:5015'));
