import { connect } from 'cloudflare:sockets';
import { DurableObject } from 'cloudflare:workers';
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
const b64=s=>{let b='';for(const x of new TextEncoder().encode(s))b+=String.fromCharCode(x);return btoa(b);};
const addr=s=>typeof s==='string'&&/^[A-Za-z0-9.!#$%&'*+\/= ?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s)&&!/[\s\r\n]/.test(s);
async function smtp(env,send){
 if(!env.QQ_EMAIL_ACCOUNT||!env.QQ_EMAIL_AUTH_CODE)throw Error('MISSING_MAIL_SECRETS');
 if(!addr(env.QQ_EMAIL_ACCOUNT)||!addr(env.TEST_RECIPIENT))throw Error('INVALID_CONFIG');
 const socket=connect({hostname:'smtp.qq.com',port:465},{secureTransport:'on'});let timer;let dataStarted=false;
 try{return await Promise.race([(async()=>{
 await socket.opened;const rd=socket.readable.getReader(),wr=socket.writable.getWriter();let buffer='';const decoder=new TextDecoder();
 async function line(){while(!buffer.includes('\r\n')){const r=await rd.read();if(r.done)throw Error('SMTP_CLOSED');buffer+=decoder.decode(r.value,{stream:true});if(buffer.length>65536)throw Error('SMTP_RESPONSE_TOO_LARGE');}const i=buffer.indexOf('\r\n');const s=buffer.slice(0,i);buffer=buffer.slice(i+2);return s;}
 async function response(expected){let first=await line();const m=/^(\d{3})([ -])/.exec(first);if(!m)throw Error('SMTP_PROTOCOL_ERROR');const code=Number(m[1]);if(m[2]==='-'){let count=0;while(true){const x=await line();if(x.startsWith(m[1]+' '))break;if(++count>100)throw Error('SMTP_PROTOCOL_ERROR');}}if(!expected.includes(code))throw Error('SMTP_REJECTED_'+code);return code;}
 async function command(text,codes){await wr.write(new TextEncoder().encode(text+'\r\n'));return response(codes);}
 await response([220]);await command('EHLO qq-mail-assistant.example',[250]);await command('AUTH LOGIN',[334]);await command(b64(env.QQ_EMAIL_ACCOUNT),[334]);await command(b64(env.QQ_EMAIL_AUTH_CODE),[235]);
 if(!send){await command('QUIT',[221]);return {tlsConnected:true,smtpAuthenticated:true};}
 const marker='QQ-SMTP-TEST-20261018-A1';const messageId='<'+marker.toLowerCase()+'@qq.com>';
 const body='QQ 邮箱助手发送测试。\n\n这是经用户授权发送的一封连通性测试邮件，用于确认 QQ SMTP → Gmail 投递。\n唯一标记：'+marker+'\n\n本邮件不包含邮箱授权码或其他凭据。';
 const raw=['From: '+env.QQ_EMAIL_ACCOUNT,'To: '+env.TEST_RECIPIENT,'Subject: =?UTF-8?B?'+b64('QQ 邮箱助手发送测试 '+marker)+'?=','Date: '+new Date().toUTCString(),'Message-ID: '+messageId,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',''+b64(body).match(/.{1,76}/g).join('\r\n')].join('\r\n');
 await command('MAIL FROM:<'+env.QQ_EMAIL_ACCOUNT+'>',[250]);await command('RCPT TO:<'+env.TEST_RECIPIENT+'>',[250,251]);await command('DATA',[354]);
 dataStarted=true;await wr.write(new TextEncoder().encode(raw+'\r\n.\r\n'));await response([250]);
 // Acceptance is final even if QUIT fails. Never retry automatically after DATA.
 return {acceptedBySmtp:true,messageId,marker,recipient:env.TEST_RECIPIENT};
 })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('SMTP_TIMEOUT')),20000);})]);}
 catch(e){const error=new Error(dataStarted?'SEND_OUTCOME_UNKNOWN':e.message);throw error;}
 finally{clearTimeout(timer);await socket.close().catch(()=>{});}
}
export class MailTest extends DurableObject {
 async fetch(req){
 const path=new URL(req.url).pathname;
 if(path==='/probe'){try{return json(await smtp(this.env,false));}catch(e){return json({error:e.message},502);}}
 if(path!=='/send-test')return json({error:'NOT_FOUND'},404);
 const reserved=await this.ctx.storage.transaction(async tx=>{const old=await tx.get('test');if(old)return {old};await tx.put('test',{state:'reserved',createdAt:new Date().toISOString()});return {new:true};});
 if(reserved.old)return json({alreadyAttempted:true,...reserved.old});
 try{const result=await smtp(this.env,true);await this.ctx.storage.put('test',{state:'accepted',...result});return json(result);}
 catch(e){await this.ctx.storage.put('test',{state:'failed_or_unknown',error:e.message});return json({error:e.message,automaticRetry:false},502);}
 }
}
export default {async fetch(req,env){
 const path=new URL(req.url).pathname;
 if(req.method!=='POST'||!['/probe','/send-test'].includes(path))return json({error:'NOT_FOUND'},404);
 if(!env.RELAY_TOKEN||req.headers.get('Authorization')!=='Bearer '+env.RELAY_TOKEN)return json({error:'UNAUTHORIZED'},401);
 return env.MAIL_TEST.getByName('single-authorized-gmail-test-20261018').fetch(req);
}};
