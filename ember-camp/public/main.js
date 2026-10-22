import { WorldRenderer } from './render.js';
const $=id=>document.getElementById(id);
const el={modal:$('modal'),result:$('result'),hud:$('hud'),nickname:$('nickname'),mode:$('mode'),code:$('inviteCode'),menuError:$('menuError'),status:$('connection'),statusText:$('connectionText')};
let renderer;
try {renderer=new WorldRenderer($('world'));}
catch(e){el.menuError.textContent='无法创建 3D 画面：'+e.message+'。请在支持 WebGL 的浏览器中打开。';}
let ws=null,snapshot=null,session=null,selfId=null,selectedBuild=null,shownResult=false;
let lastSend=0,renderTime=0,toastUntil=0,logFeed=[],autoRetry=null,retryUntil=0,userExit=false;
let keepaliveTimer=null,attempts=0;
const pressed=new Set(),mobilePressed=new Set();
const showToast=(text)=>{const n=$('toast');n.textContent=text;n.classList.add('shown');toastUntil=Date.now()+2600;};
function setStatus(text,connected=false){el.statusText.textContent=text;el.status.classList.toggle('connected',connected);}
function send(type,data={}){if(ws?.readyState===WebSocket.OPEN&&session)ws.send(JSON.stringify({type,...data}));}
function name(){return el.nickname.value.trim().slice(0,12)||'幸存者';}
function menuError(text){el.menuError.textContent=text;}
function connect(mode,code='',saved=null){
 if(!renderer)return;
 if(ws && ws.readyState===WebSocket.OPEN && !session){ws.close();}
 clearInterval(keepaliveTimer);
 attempts++;
 userExit=false;menuError('正在连接游戏服务器……');
 const scheme=location.protocol==='https:'?'wss':'ws';
 const socket=new WebSocket(`${scheme}://${location.host}/ws`);ws=socket;
 let handledWelcome=false;
 socket.addEventListener('open',()=>{
   keepaliveTimer=setInterval(()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'ping'}));},10000);
   if(mode==='create')socket.send(JSON.stringify({type:'create',name:name(),mode:el.mode.value}));
   else socket.send(JSON.stringify({type:'join',code,name:name(),token:saved?.token||''}));
 });
 socket.addEventListener('message',ev=>{
   if(socket!==ws)return;
   let msg;try{msg=JSON.parse(ev.data);}catch{return;}
   if(msg.type==='error'){
     menuError(msg.message);showToast(msg.message);
     if(!handledWelcome){clearTimeout(autoRetry);retryUntil=0;session=null;sessionStorage.removeItem('ember-session');socket.close();}
   }else if(msg.type==='welcome'){
     handledWelcome=true;session={code:msg.code,token:msg.token,playerId:msg.playerId,at:Date.now()};selfId=msg.playerId;
     sessionStorage.setItem('ember-session',JSON.stringify(session));
     $('roomCode').textContent=msg.code;el.modal.classList.add('hidden');el.hud.classList.remove('hidden');
     setStatus('联机正常',true); menuError('');clearTimeout(autoRetry);retryUntil=0;attempts=0;
     if(saved)showToast('已恢复营地连接'); else showToast(`欢迎进入房间 ${msg.code}`);
   }else if(msg.type==='snapshot'){snapshot=msg;updateHUD();}
   else if(msg.type==='notice'){showToast(msg.text);}
   else if(msg.type==='event'){
     logFeed.unshift({text:msg.text,ts:Date.now()});logFeed=logFeed.slice(0,5);
     if(msg.text.includes('第 ')||msg.text.includes('胜利'))showToast(msg.text);
   }
 });
 socket.addEventListener('close',()=>{
   clearInterval(keepaliveTimer);
   if(socket!==ws)return;
   if(handledWelcome && !userExit && !snapshot?.over && session){
     setStatus('网络断开，尝试重连');
     retryUntil=retryUntil||Date.now()+27000;
     if(Date.now()<retryUntil)autoRetry=setTimeout(()=>connect('join',session.code,session),2200);
     else {setStatus('已离线');showToast('房间已失效，请重新创建');resetToLobby();}
   }else if(!handledWelcome){setStatus('未连接');}
 });
 socket.addEventListener('error',()=>{if(!handledWelcome)menuError('无法连接服务器，请确认游戏服务正在运行');});
}
$('createBtn').addEventListener('click',()=>{retryUntil=0;connect('create');});
function resetToLobby(){
 userExit=true;clearTimeout(autoRetry);clearInterval(keepaliveTimer);ws?.close();ws=null;snapshot=null;session=null;selfId=null;selectedBuild=null;shownResult=false;
 sessionStorage.removeItem('ember-session');el.modal.classList.remove('hidden');el.hud.classList.add('hidden');el.result.classList.add('hidden');setStatus('等待连接');
}
const linkedCode=new URLSearchParams(location.search).get('room');
if(linkedCode && /^[A-HJ-NP-Z2-9]{6}$/i.test(linkedCode)){el.code.value=linkedCode.toUpperCase();menuError('已填入好友邀请码，输入昵称后点击「加入」即可');}
$('shareBtn').addEventListener('click',async()=>{
 const code=session?.code;if(!code)return;
 const url=new URL(location.origin);url.searchParams.set('room',code);
 const shareData={title:'余烬营地｜一起生存',text:`来我的营地一起防守吧！邀请码：${code}`,url:url.toString()};
 try{if(navigator.share)await navigator.share(shareData);else {await navigator.clipboard.writeText(url.toString());showToast('邀请链接已复制，发给朋友即可');}}
 catch(e){if(e?.name==='AbortError')return;try{await navigator.clipboard.writeText(url.toString());showToast('邀请链接已复制');}catch{showToast('邀请码：'+code);}}
});
$('joinBtn').addEventListener('click',()=>{
 const code=el.code.value.trim().toUpperCase();if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code)){menuError('请输入有效的六位房间码');return;}
 retryUntil=0;connect('join',code);
});
el.code.addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);});
el.code.addEventListener('keydown',e=>{if(e.key==='Enter')$('joinBtn').click();});
$('copyCode').addEventListener('click',async()=>{
 const code=session?.code;if(!code)return;
 try{await navigator.clipboard.writeText(code);showToast('房间码已复制');}catch{showToast('房间码：'+code);}
});
function self(){return snapshot?.players?.find(p=>p.id===selfId);}
function doGather(){send('gather');}
function doAttack(){send('attack');}
function doEat(){send('eat');}
function selectBuild(kind){selectedBuild=selectedBuild===kind?null:kind;
 $('wallBtn').classList.toggle('selected',selectedBuild==='wall');$('fireBtn').classList.toggle('selected',selectedBuild==='fire');
 if(selectedBuild)showToast(`已选择${selectedBuild==='wall'?'木墙':'篝火'}，按 B 或点击建造`);
}
function doBuild(){if(!selectedBuild)return showToast('请先选择木墙（1）或篝火（2）');const p=self();if(!p)return;
 const x=Math.round((p.x+Math.sin(p.face||0)*4.2)/2)*2,z=Math.round((p.z+Math.cos(p.face||0)*4.2)/2)*2;
 send('build',{kind:selectedBuild,x,z});}
$('gatherBtn').addEventListener('click',doGather);$('attackBtn').addEventListener('click',doAttack);$('eatBtn').addEventListener('click',doEat);
$('wallBtn').addEventListener('click',()=>selectBuild('wall'));$('fireBtn').addEventListener('click',()=>selectBuild('fire'));
$('buildBtn').addEventListener('click',doBuild);
$('againBtn').addEventListener('click',()=>{
 resetToLobby();
});
window.addEventListener('keydown',e=>{
 if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;
 const key=e.key.toLowerCase();
 if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(key))e.preventDefault();
 pressed.add(key);
 if(e.repeat||!session||snapshot?.over)return;
 if(key==='e')doGather();else if(key===' ')doAttack();else if(key==='1')selectBuild('wall');else if(key==='2')selectBuild('fire');else if(key==='b')doBuild();else if(key==='h')doEat();
});
window.addEventListener('keyup',e=>pressed.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>{pressed.clear();mobilePressed.clear();});
window.addEventListener('pagehide',()=>{if(session){session.at=Date.now();sessionStorage.setItem('ember-session',JSON.stringify(session));}});
for(const btn of document.querySelectorAll('[data-dir]')){
 const key=btn.dataset.dir;
 btn.addEventListener('pointerdown',e=>{e.preventDefault();btn.setPointerCapture(e.pointerId);mobilePressed.add(key);btn.classList.add('held');});
 for(const ev of ['pointerup','pointercancel','lostpointercapture'])btn.addEventListener(ev,()=>{mobilePressed.delete(key);btn.classList.remove('held');});
}
function movement(){let dx=0,dz=0;
 if(pressed.has('w')||pressed.has('arrowup')||mobilePressed.has('up'))dz--;
 if(pressed.has('s')||pressed.has('arrowdown')||mobilePressed.has('down'))dz++;
 if(pressed.has('a')||pressed.has('arrowleft')||mobilePressed.has('left'))dx--;
 if(pressed.has('d')||pressed.has('arrowright')||mobilePressed.has('right'))dx++;
 const m=Math.hypot(dx,dz);return {dx:m>1?dx/m:dx,dz:m>1?dz/m:dz};
}
function updateHUD(){if(!snapshot || !session)return;
 const me=self(),wave=snapshot.day;
 $('dayChip').textContent=`DAY ${wave}`;
 $('coreLabel').textContent=`${snapshot.coreHp} / 300`; $('coreBar').style.width=`${Math.max(0,snapshot.coreHp/3)}%`;
 if(me){$('hpLabel').textContent=`${me.hp} / 100`;$('hpBar').style.width=`${me.hp}%`;
 $('wood').textContent=me.wood;$('stone').textContent=me.stone;$('berries').textContent=me.berries;}
 $('playerCount').textContent=`${snapshot.count} / 4`;
 const list=$('playerList');list.replaceChildren();for(const p of snapshot.players){const div=document.createElement('div');div.className='member'+(p.connected?'':' offline');
 const t=document.createElement('span');t.textContent=p.name+(p.hp<=0?'（倒地）':'');div.append(t);
 if(p.id===selfId){const y=document.createElement('span');y.className='you';y.textContent='你';div.append(y);}list.append(div);}
 const isNight=snapshot.phase==='night';$('phaseIcon').textContent=isNight?'☾':'☀';
 $('phaseText').textContent=isNight?'黑夜 · 怪物来袭':'白天 · 准备阶段';
 $('phaseHint').textContent=isNight?'保卫营地核心！':'收集资源，提前布防';
 const remaining=Math.max(0,Math.ceil(snapshot.phaseLength-snapshot.elapsed));$('timer').textContent=`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
 $('timerBar').style.width=`${Math.max(0,remaining/snapshot.phaseLength*100)}%`;
 $('waveText').textContent=isNight?`第 ${wave} 夜 · ${snapshot.mobs.length} 个怪物正在活动`:'怪物将在天黑后出现';
 $('objectiveText').textContent=wave===3?'最后一夜！守住核心就能获胜':'守住营地核心，撑过三夜';
 if(snapshot.over&&!shownResult){shownResult=true;showResults(snapshot.win);}
}
function showResults(win){$('resultIcon').textContent=win?'✦':'☾';$('resultTitle').textContent=win?'三夜坚守成功！':'营地沦陷';$('resultDesc').textContent=win?'你们守护了最后的篝火。下一次远征，世界还会有新的挑战。':'再收集一些木材，和朋友一起建造更多防线吧。';
 el.result.classList.remove('hidden');}
function updateFeed(){const now=Date.now();logFeed=logFeed.filter(q=>now-q.ts<4500);const feed=$('eventFeed');feed.replaceChildren();
 for(const q of logFeed.slice(0,2)){const d=document.createElement('div');d.textContent=q.text;feed.append(d);}
 if(now>toastUntil)$('toast').classList.remove('shown');}
function frame(time){requestAnimationFrame(frame);
 if(time-lastSend>90 && ws?.readyState===WebSocket.OPEN && session){send('move',movement());lastSend=time;}
 if(time-renderTime>14){try{renderer?.render(snapshot,selfId,session?selectedBuild:null);}catch(e){console.error('渲染错误',e);renderer=null;showToast('3D 渲染失败，请检查 WebGL');}renderTime=time;}
 if(Math.floor(time/400)!==Math.floor((time-16)/400))updateFeed();
}
requestAnimationFrame(frame);
// 如果标签页在 30 秒内意外刷新，尽量恢复原房间。
try {const saved=JSON.parse(sessionStorage.getItem('ember-session')||'null');
 if(saved && Date.now()-saved.at<28000 && saved.code && saved.token){el.code.value=saved.code;retryUntil=Date.now()+25000;connect('join',saved.code,saved);}}
catch{}
