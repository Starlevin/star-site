import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT || 3000);
const MAX_PLAYERS = 4;
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 28);
const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS || 120);
const MAX_CONNECTIONS_PER_IP = 8;
const activeSockets = new Set();
const ipSockets = new Map();
const BUILD_VERSION = '0.2.0';
const TICK = 50;
const STEP = TICK / 1000;
const WORLD_HALF = 46;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();
const nameSafe = value => String(value || '幸存者').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 12) || '幸存者';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
function seeded(seed) {
  let x = seed >>> 0 || 0x12345678;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
}
function code() {
  let s;
  do { s = Array.from(crypto.randomBytes(6), b => CODE_CHARS[b % CODE_CHARS.length]).join(''); }
  while (rooms.has(s));
  return s;
}
function dist(a,b) { return Math.hypot(a.x-b.x, a.z-b.z); }
function near(a,b,d) {return dist(a,b) < d;}
function makeWorld(seed) {
  const r = seeded(seed);
  const objects = [];
  let id=0;
  for (const [kind,count,hp] of [['tree',42,3], ['rock',25,4], ['berry',18,2]]) {
    for (let tries=0,added=0; tries<1300 && added<count;tries++) {
      const x=(r()-.5)*86,z=(r()-.5)*86;
      if (Math.hypot(x,z) < 13 || objects.some(o=>Math.hypot(x-o.x,z-o.z)<3.0)) continue;
      objects.push({id:`r${id++}`,kind,x:Math.round(x*10)/10,z:Math.round(z*10)/10,hp,maxHp:hp,style:Math.floor(r()*4)});
      added++;
    }
  }
  return objects;
}
function newRoom(seed, mode) {
  const room = {
    code:code(), seed, mode:mode==='normal'?'normal':'demo',
    phase:'day', elapsed:0, day:1, win:false, over:false, coreHp:300,
    players:new Map(), resources:makeWorld(seed), buildings:[], mobs:[],
    nextId:1, lastMob:0, messages:[], version:0
  };
  rooms.set(room.code,room); return room;
}
function safeNumber(n, def=0) {return Number.isFinite(n)? n:def;}
function send(conn, obj) {
  if (!conn || conn.closed) return;
  const data = Buffer.from(JSON.stringify(obj));
  const len=data.length;
  let header;
  if (len<126) {header=Buffer.from([0x81,len]);}
  else if (len<=65535) {header=Buffer.alloc(4);header[0]=0x81;header[1]=126;header.writeUInt16BE(len,2);}
  else {header=Buffer.alloc(10);header[0]=0x81;header[1]=127;header.writeBigUInt64BE(BigInt(len),2);}
  if (!conn.socket.destroyed) conn.socket.write(Buffer.concat([header,data]));
}
function broadcast(room, obj) {for (const p of room.players.values()) send(p.conn,obj);}
function event(room, msg) {
  const str=String(msg).slice(0,90);
  room.messages.unshift(str);room.messages.length=Math.min(8,room.messages.length);
  broadcast(room,{type:'event',text:str});
}
function toSnapshot(room) {return {
  type:'snapshot',phase:room.phase,day:room.day,elapsed:Math.round(room.elapsed*10)/10,
  phaseLength:room.phase==='day'?(room.mode==='demo'?42:180):(room.mode==='demo'?28:90),
  coreHp:room.coreHp,over:room.over,win:room.win,
  players:[...room.players.values()].map(p=>({id:p.id,name:p.name,x:p.x,z:p.z,hp:p.hp,wood:p.wood,stone:p.stone,berries:p.berries,connected:!!p.conn&& !p.conn.closed,face:p.face,attack:p.attackFx,inv:p.invFx})),
  resources:room.resources,buildings:room.buildings,mobs:room.mobs.map(m=>({id:m.id,x:m.x,z:m.z,hp:m.hp,face:m.face})),
  count:room.players.size
};}
function cleanupLeave(conn) {
  conn.closed=true;
  if (!conn.player || !conn.room) return;
  const p=conn.player;
  if (p.conn !== conn) return;
  p.conn=null;p.dx=0;p.dz=0;p.disconnectedAt=Date.now();
  event(conn.room,`${p.name} 掉线（30 秒内可重新连接）`);
}
function enter(conn, msg) {
  if (conn.room) return send(conn,{type:'error',message:'已在房间中'});
  let room;
  if (msg.type==='create') {
    const seed=(Number.isSafeInteger(msg.seed) && msg.seed>0 && msg.seed<4294967296)?msg.seed:crypto.randomBytes(4).readUInt32BE();
    if(rooms.size >= MAX_ROOMS) return send(conn,{type:'error',message:'当前房间已满，请稍后再创建'});
    room=newRoom(seed,msg.mode);
  } else {
    room=rooms.get(String(msg.code||'').toUpperCase().trim());
    if (!room) return send(conn,{type:'error',message:'房间不存在或已结束'});
  }
  const reconnectToken=typeof msg.token==='string'?msg.token:'';
  let p=[...room.players.values()].find(q=>q.token===reconnectToken && reconnectToken && !q.conn && q.disconnectedAt && Date.now()-q.disconnectedAt<30000);
  if (!p && (room.over || room.players.size >= MAX_PLAYERS)) return send(conn,{type:'error',message:room.over?'本局已经结束':'房间已满（最多四人）'});
  if (!p) {
    const index=room.players.size;
    p={id:crypto.randomBytes(5).toString('hex'),token:crypto.randomBytes(16).toString('hex'),name:nameSafe(msg.name),x:Math.cos(index*Math.PI/2)*3,z:Math.sin(index*Math.PI/2)*3,hp:100,wood:8,stone:4,berries:0,dx:0,dz:0,face:0,attackFx:0,invFx:0,attackCd:0,gatherCd:0,buildCd:0,disconnectedAt:0,conn:null};
    room.players.set(p.id,p);
  }
  p.conn=conn;p.disconnectedAt=0;conn.room=room;conn.player=p;
  send(conn,{type:'welcome',playerId:p.id,token:p.token,code:room.code,seed:room.seed,mode:room.mode,worldSize:WORLD_HALF*2});
  send(conn,toSnapshot(room));
  event(room,`${p.name} ${reconnectToken===p.token?'回到了':'加入了'}营地`);
}
function moveBuild(room,p,x,z,kind) {
  if (room.over||room.phase==='night'&&kind==='fire') return false;
  if (!['wall','fire'].includes(kind)) return false;
  x=Math.round(safeNumber(x,9999)/2)*2;
  z=Math.round(safeNumber(z,9999)/2)*2;
  if (Math.abs(x)>WORLD_HALF-3||Math.abs(z)>WORLD_HALF-3) return false;
  if (!near(p,{x,z},8.0) || Math.hypot(x,z)<3.7) return false;
  if (room.buildings.some(b=>Math.hypot(b.x-x,b.z-z)<2.1)) return false;
  if (room.resources.some(r=>r.hp>0 && Math.hypot(r.x-x,r.z-z)<2.0)) return false;
  if (kind==='wall' && p.wood<4) return false;
  if (kind==='fire' && (p.wood<5 || p.stone<3)) return false;
  p.wood-=kind==='wall'?4:5;p.stone-=kind==='fire'?3:0;
  room.buildings.push({id:'b'+room.nextId++,kind,x,z,hp:kind==='wall'?120:85,maxHp:kind==='wall'?120:85});
  return true;
}
function action(conn,msg) {
  const p=conn.player,room=conn.room;
  if (!p||room.over||p.hp<=0) return;
  const now=Date.now();
  if (msg.type==='move') {
    const dx=clamp(safeNumber(msg.dx),-1,1),dz=clamp(safeNumber(msg.dz),-1,1);
    const l=Math.hypot(dx,dz);
    p.dx=l>1?dx/l:dx;p.dz=l>1?dz/l:dz;
    if(l>.05)p.face=Math.atan2(p.dx,p.dz);
  } else if (msg.type==='gather') {
    if (now<p.gatherCd) return;
    p.gatherCd=now+470;
    const nearest=room.resources.filter(r=>r.hp>0&&near(r,p,3.5)).sort((a,b)=>dist(a,p)-dist(b,p))[0];
    if(!nearest) return send(conn,{type:'notice',text:'走近树木、石头或浆果丛再采集'});
    nearest.hp-=1;
    if (nearest.kind==='tree') p.wood+=2;
    if (nearest.kind==='rock')p.stone+=2;
    if (nearest.kind==='berry')p.berries+=2;
    p.invFx=3;
  } else if (msg.type==='build') {
    if(now<p.buildCd)return;
    p.buildCd=now+300;
    const kind=msg.kind==='fire'?'fire':'wall';
    if (!moveBuild(room,p,msg.x,msg.z,kind)) send(conn,{type:'notice',text:'无法建造：检查资源、距离与地形'});
  } else if (msg.type==='attack') {
    if(now<p.attackCd)return;
    p.attackCd=now+650;p.attackFx=7;
    let target=null,best=3.8;
    for(const m of room.mobs) {const d=dist(p,m);if(d<best){best=d;target=m;}}
    if(target){target.hp-=22;target.hit=4; if(target.hp<=0){room.mobs.splice(room.mobs.indexOf(target),1);p.wood+=1;}}
  } else if (msg.type==='eat') {
    if(p.berries>0 && p.hp<100) {p.berries--;p.hp=Math.min(100,p.hp+25);}
  }
}
function blocked(room,x,z,r=.45) {
  if (room.buildings.some(b=>b.hp>0 && Math.abs(b.x-x)<(b.kind==='wall'?1.1:0.85)+r && Math.abs(b.z-z)<0.5+r)) return true;
  return false;
}
function tick(room) {
  if(room.over) return;
  const secs=room.mode==='demo'?[42,28]:[180,90];
  room.elapsed+=STEP;
  for(const p of room.players.values()) {
    if(p.hp<=0){p.dx=0;p.dz=0;continue;}
    const speed=4.6;
    const nx=clamp(p.x+p.dx*speed*STEP,-WORLD_HALF,WORLD_HALF),nz=clamp(p.z+p.dz*speed*STEP,-WORLD_HALF,WORLD_HALF);
    if(!blocked(room,nx,p.z)) p.x=nx;
    if(!blocked(room,p.x,nz)) p.z=nz;
    p.attackFx=Math.max(0,p.attackFx-1);p.invFx=Math.max(0,p.invFx-1);
  }
  if(room.phase==='night') {
    room.lastMob+=STEP;
    const mobCap=5+room.day*4+room.players.size*2;
    const spawnGap=room.mode==='demo'? 3.25:5.5;
    if (room.lastMob>=spawnGap && room.mobs.length<mobCap){
      room.lastMob=0;let angle=rnd(0,Math.PI*2);
      const radius=22+Math.random()*5;
      room.mobs.push({id:'m'+room.nextId++,x:Math.cos(angle)*radius,z:Math.sin(angle)*radius,hp:38+room.day*8,face:0,cooldown:0,hit:0});
    }
  }
  for(const mob of [...room.mobs]){
    mob.cooldown=Math.max(0,mob.cooldown-STEP);
    mob.hit=Math.max(0,mob.hit-1);
    const targets=[...room.players.values()].filter(p=>p.hp>0&&dist(mob,p)<9);
    targets.sort((a,b)=>dist(mob,a)-dist(mob,b));
    let target=targets[0]||{x:0,z:0,hp:room.coreHp,id:'core'};
    let shield=room.buildings.filter(b=>b.hp>0&&dist(mob,b)<3.0).sort((a,b)=>dist(mob,a)-dist(mob,b))[0];
    if(shield)target=shield;
    const d=dist(mob,target),dirx=(target.x-mob.x)/(d||1),dirz=(target.z-mob.z)/(d||1);
    mob.face=Math.atan2(dirx,dirz);
    if(d>1.45) {mob.x+=dirx*(2.1+room.day*.15)*STEP;mob.z+=dirz*(2.1+room.day*.15)*STEP;}
    else if(mob.cooldown<=0) {
      mob.cooldown=1.25;
      if(target.id==='core')room.coreHp=Math.max(0,room.coreHp-12);
      else {target.hp=Math.max(0,target.hp-10);if(target.hp===0 && target.name) event(room,`${target.name} 倒下了`);}
      room.buildings=room.buildings.filter(b=>b.hp>0);
    }
  }
  if (room.coreHp<=0 || [...room.players.values()].every(p=>p.hp<=0)) {
    room.over=true;room.win=false;event(room,'营地沦陷了！');return;
  }
  if (room.elapsed>=secs[room.phase==='day'?0:1]) {
    room.elapsed=0;room.lastMob=0;
    if (room.phase==='day') {
      room.phase='night';event(room,`第 ${room.day} 夜：怪物正在袭来！`);
    } else {
      room.mobs=[];
      if(room.day>=3){room.over=true;room.win=true;event(room,'成功坚守三夜！远征胜利！');}
      else {room.day++;room.phase='day';event(room,`第 ${room.day} 天到来，继续准备防御`);}
    }
  }
}
function routeMessage(conn,raw) {
  if (raw.length>8192) return;
  let msg;
  try {msg=JSON.parse(raw);} catch{return;}
  if (!msg || typeof msg!=='object' || typeof msg.type!=='string')return;
  const now=Date.now();
  if(now-conn.rateStart>1000){conn.rateStart=now;conn.rate=0;}
  if(++conn.rate>80)return;
  if(msg.type==='create'||msg.type==='join')enter(conn,msg);
  else if(conn.room&&conn.player)action(conn,msg);
}
function acceptWebsocket(socket,key,head,ip) {
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const conn={socket,ip,buffer:Buffer.alloc(0),closed:false,rateStart:Date.now(),rate:0,room:null,player:null};
  activeSockets.add(socket);ipSockets.set(ip,(ipSockets.get(ip)||0)+1);
  socket.on('data',data=>{
    if(conn.closed)return;
    conn.buffer=Buffer.concat([conn.buffer,data]);
    if(conn.buffer.length>100000){socket.destroy();return;}
    for(let loops=0;loops<40;loops++){
      const buf=conn.buffer;
      if(buf.length<2)break;
      const opcode=buf[0]&15,fin=!!(buf[0]&128),masked=!!(buf[1]&128);
      let len=buf[1]&127,offset=2;
      if(len===126){if(buf.length<4)break;len=buf.readUInt16BE(2);offset=4;}
      else if(len===127){if(buf.length<10)break;const large=buf.readBigUInt64BE(2);if(large>8192n){socket.destroy();return;}len=Number(large);offset=10;}
      if(!masked || !fin || len>8192){socket.destroy();return;}
      if(buf.length<offset+4+len)break;
      const mask=buf.subarray(offset,offset+4),payload=Buffer.from(buf.subarray(offset+4,offset+4+len));
      for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];
      conn.buffer=buf.subarray(offset+4+len);
      if(opcode===8){socket.end();return;}
      if(opcode===9){socket.write(Buffer.from([0x8A,payload.length,...payload]));continue;}
      if(opcode===1)routeMessage(conn,payload.toString('utf8'));
      if(conn.closed)break;
    }
  });
  socket.on('close',()=>{cleanupLeave(conn);activeSockets.delete(socket); const n=(ipSockets.get(conn.ip)||1)-1;if(n>0)ipSockets.set(conn.ip,n);else ipSockets.delete(conn.ip);});
  socket.on('error',()=>cleanupLeave(conn));
  if(head?.length)socket.emit('data',head);
}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
const server=http.createServer((req,res)=>{
  let p;
  try{p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
  if(p==='/health') {res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true,version:BUILD_VERSION,rooms:rooms.size,players:[...rooms.values()].reduce((n,r)=>n+r.players.size,0),uptimeSeconds:Math.floor(process.uptime())}));return;}
  const clean=path.normalize(p).replace(/^[/\\]+/,'');
  const fp=path.resolve(root,clean||'index.html');
  if(!fp.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(fp,(err,data)=>{
    if(err){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(fp)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    res.end(data);
  });
});
server.on('upgrade',(req,socket,head)=>{
  let origin;
  try {origin=new URL(req.headers.origin);} catch{socket.destroy();return;}
  const host=(req.headers.host||'').split(':')[0].toLowerCase();
  if(req.url!=='/ws' || origin.hostname.toLowerCase()!==host || req.headers.upgrade?.toLowerCase()!=='websocket' || !req.headers['sec-websocket-key'] || req.headers['sec-websocket-version']!=='13'){
    socket.destroy();return;
  }
  const ip=String(req.headers['x-forwarded-for']||socket.remoteAddress||'').split(',')[0].trim();
  if(activeSockets.size >= MAX_CONNECTIONS || (ipSockets.get(ip)||0)>=MAX_CONNECTIONS_PER_IP){socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');socket.destroy();return;}
  acceptWebsocket(socket,req.headers['sec-websocket-key'],head,ip);
});
let cycles=0;
setInterval(()=>{
  cycles++;
  for(const room of rooms.values()){
    for(const p of [...room.players.values()])if(!p.conn && Date.now()-p.disconnectedAt>30000){room.players.delete(p.id);event(room,`${p.name} 离开了营地`);}
    if(room.players.size===0){rooms.delete(room.code);continue;}
    tick(room);
    if(cycles%4===0)broadcast(room,toSnapshot(room));
  }
},TICK).unref();
server.listen(PORT,'0.0.0.0',()=>console.log(`余烬营地 v${BUILD_VERSION} 已启动，监听 0.0.0.0:${PORT}`));
export {server, rooms, moveBuild, makeWorld, newRoom};
