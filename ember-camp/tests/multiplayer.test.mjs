import { test } from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import crypto from 'node:crypto';
import {once,EventEmitter} from 'node:events';

const PORT=32271;
class Peer extends EventEmitter {
  constructor(sock){super();this.sock=sock;this.buffer=Buffer.alloc(0);this.messages=[];
    sock.on('data',d=>this.ingest(d));
  }
  ingest(d){this.buffer=Buffer.concat([this.buffer,d]);while(this.buffer.length>=2){
    const op=this.buffer[0]&15,masked=!!(this.buffer[1]&128);let len=this.buffer[1]&127,pos=2;
    if(len===126){if(this.buffer.length<4)return;len=this.buffer.readUInt16BE(2);pos=4;}
    else if(len===127){if(this.buffer.length<10)return;len=Number(this.buffer.readBigUInt64BE(2));pos=10;}
    const size=pos+(masked?4:0)+len;
    if(this.buffer.length<size)return;
    let payload=this.buffer.subarray(pos+(masked?4:0),size);
    if(op===1){const msg=JSON.parse(payload.toString('utf8'));this.messages.push(msg);this.emit('message',msg);}
    this.buffer=this.buffer.subarray(size);
  }}
  send(value){const payload=Buffer.from(JSON.stringify(value)),mask=crypto.randomBytes(4),len=payload.length;
    let head=len<126?Buffer.from([0x81,0x80|len]):Buffer.from([0x81,0x80|126,len>>8,len&255]);
    const masked=Buffer.from(payload);for(let i=0;i<masked.length;i++)masked[i]^=mask[i%4];
    this.sock.write(Buffer.concat([head,mask,masked]));
  }
  wait(type,filter=()=>true,timeout=3500){for(let i=0;i<this.messages.length;i++){
    if(this.messages[i].type===type&&filter(this.messages[i]))return Promise.resolve(this.messages.splice(i,1)[0]);}
    return new Promise((resolve,reject)=>{
      const t=setTimeout(()=>{this.off('message',handler);reject(Error('等待 '+type+' 超时'));},timeout);
      const handler=m=>{if(m.type!==type||!filter(m))return;clearTimeout(t);this.off('message',handler);const i=this.messages.indexOf(m);if(i>=0)this.messages.splice(i,1);resolve(m);};
      this.on('message',handler);
    });
  }
  close(){this.sock.end();}
}
async function connect(){return new Promise((resolve,reject)=>{
  const sock=net.connect(PORT,'127.0.0.1');let buf='';
  sock.once('connect',()=>sock.write('GET /ws HTTP/1.1\r\nHost: 127.0.0.1:'+PORT+'\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nOrigin: http://127.0.0.1:'+PORT+'\r\nSec-WebSocket-Key: '+crypto.randomBytes(16).toString('base64')+'\r\nSec-WebSocket-Version: 13\r\n\r\n'));
  const onData=data=>{buf+=data.toString('latin1');const pos=buf.indexOf('\r\n\r\n');if(pos<0)return;
    sock.off('data',onData);if(!buf.startsWith('HTTP/1.1 101')){reject(Error(buf.slice(0,80)));return;}
    const peer=new Peer(sock);const extra=Buffer.from(buf.slice(pos+4),'latin1');if(extra.length)peer.ingest(extra);resolve(peer);
  };sock.on('data',onData);sock.on('error',reject);
});}
let proc,alice,bob;
test('真实双人联机 + 建造同步 + 服务器权威校验',async t=>{
  proc=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(PORT)},stdio:'pipe'});
  t.after(()=>{alice?.close();bob?.close();proc.kill();});
  for(let i=0;i<60;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/health`);if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  const page=await fetch(`http://127.0.0.1:${PORT}/`);assert.equal(page.status,200);assert.match(await page.text(),/最后的/);
  alice=await connect();alice.send({type:'create',name:'测试甲',mode:'demo',seed:20261022});
  const aw=await alice.wait('welcome');assert.match(aw.code,/^[A-Z2-9]{6}$/);
  assert.equal(aw.seed,20261022);const a0=await alice.wait('snapshot');assert.equal(a0.players.length,1);
  bob=await connect();bob.send({type:'join',name:'测试乙',code:aw.code});
  const bw=await bob.wait('welcome');assert.equal(bw.code,aw.code);
  const both=await bob.wait('snapshot',s=>s.players.length===2);
  assert.equal(both.players.length,2);
  alice.send({type:'build',kind:'wall',x:6,z:0});
  const built=await bob.wait('snapshot',s=>s.buildings.length===1);
  assert.equal(built.buildings[0].kind,'wall');
  const owner=built.players.find(p=>p.id===aw.playerId);assert.equal(owner.wood,4);
  alice.send({type:'damage',amount:99999,target:'core'});
  const next=await bob.wait('snapshot',s=>s.buildings.length===1);
  assert.equal(next.coreHp,300,'客户端不能直接修改核心 HP');
  alice.send({type:'move',dx:-1,dz:0});
  const shifted=await bob.wait('snapshot',s=>s.players.some(p=>p.id===aw.playerId&&p.x<2));
  assert(shifted.players.find(p=>p.id===aw.playerId).x<2);
});
