import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validate, readJson } from './validation.mjs';
const input={request_id:'test_request_00000001',to:['someone@example.com'],subject:'测试主题',text:'正文'};
const source=await readFile(new URL('./service.mjs',import.meta.url),'utf8');
const validationUrl=new URL('./validation.mjs',import.meta.url).href;
const moduleSource=source.replace("import { DurableObject } from 'cloudflare:workers';",'class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }').replace("'./validation.mjs'",JSON.stringify(validationUrl)).replace("import { smtp } from './smtp.mjs';",'const smtp=(...args)=>globalThis.mockSmtp(...args);');
const {MailSender}=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));
function state(){const data=new Map();let queue=Promise.resolve();const storage={get:async key=>structuredClone(data.get(key)),put:async(key,v)=>data.set(key,structuredClone(v)),transaction:fn=>{const result=queue.then(()=>fn(storage));queue=result.catch(()=>{});return result;}};return {storage,data};}
const request=(value=input)=>new Request('https://internal/send',{method:'POST',body:JSON.stringify(value)});
test('reject header injection, invalid addresses, duplicate recipients, unknown fields and oversized UTF-8',async()=>{
 for(const patch of [{subject:'x\r\nBcc: attacker@example.com'},{to:['x@example.com\r\n']},{to:['a@b.com','A@B.COM']},{to:['a@-bad.com']},{request_id:'short'},{text:'中'.repeat(50001)},{extra:true}])assert.throws(()=>validate({...input,...patch}));
 assert.deepEqual(validate(input),input);
 await assert.rejects(()=>readJson(new Request('https://local',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(262145)})),/REQUEST_TOO_LARGE/);
});
test('concurrent retries and object restart never send twice; different payload conflicts',async()=>{
 const ctx=state();let count=0;globalThis.mockSmtp=async()=>{count++;await new Promise(r=>setTimeout(r,15));};
 const sender=new MailSender(ctx,{});const responses=await Promise.all([sender.fetch(request()),sender.fetch(request())]);
 assert.equal(count,1);assert.ok(responses.some(r=>r.status===200));
 const repeat=await new MailSender(ctx,{}).fetch(request());assert.equal((await repeat.json()).state,'accepted');assert.equal(count,1);
 const conflict=await sender.fetch(request({...input,text:'changed'}));assert.equal(conflict.status,409);assert.equal((await conflict.json()).error,'IDEMPOTENCY_CONFLICT');assert.equal(count,1);
});
test('SMTP ambiguity remains non-retryable across object restart',async()=>{
 const ctx=state();let count=0;globalThis.mockSmtp=async()=>{count++;throw Error('SEND_OUTCOME_UNKNOWN');};
 const result=await new MailSender(ctx,{}).fetch(request());assert.equal((await result.json()).state,'unknown');
 const repeat=await new MailSender(ctx,{}).fetch(request());assert.equal((await repeat.json()).automaticRetry,false);assert.equal(count,1);
});
test('crash after durable reservation blocks future SMTP attempt',async()=>{
 const ctx=state();globalThis.mockSmtp=async()=>{throw Error('SMTP_REJECTED_535');};await new MailSender(ctx,{}).fetch(request());
 const old=ctx.data.get('request');ctx.data.set('request',{...old,state:'attempting'});globalThis.mockSmtp=async()=>assert.fail('must not send');
 const repeat=await new MailSender(ctx,{}).fetch(request());assert.equal((await repeat.json()).state,'unknown');
});
test('SMTP DATA acceptance survives QUIT failure, lost reply is unknown, explicit rejection is failed',async()=>{
 const smtpSource=(await readFile(new URL('./smtp.mjs',import.meta.url),'utf8')).replace("import { connect } from 'cloudflare:sockets';",'const connect=(...args)=>globalThis.fakeConnect(...args);').replace("'./validation.mjs'",JSON.stringify(validationUrl));
 const {smtp}=await import('data:text/javascript;base64,'+Buffer.from(smtpSource).toString('base64'));
 const env={QQ_EMAIL_ACCOUNT:'example@qq.com',QQ_EMAIL_AUTH_CODE:'dummy-test-only'};
 for(const mode of ['accepted','lost','rejected']){
  const commands=[];globalThis.fakeConnect=(target,options)=>{
   assert.deepEqual(target,{hostname:'smtp.qq.com',port:465});assert.equal(options.secureTransport,'on');let controller;
   const readable=new ReadableStream({start(c){controller=c;c.enqueue(new TextEncoder().encode('220 ready\r\n'));}});
   let auth=0;const writable=new WritableStream({write(bytes){const cmd=new TextDecoder().decode(bytes);commands.push(cmd);let reply;if(cmd.startsWith('EHLO'))reply='250-smtp.qq.com\r\n250 AUTH LOGIN';else if(cmd.startsWith('AUTH LOGIN'))reply='334 username';else if(auth++<2&&commands.length<=4)reply=commands.length===3?'334 password':'235 authenticated';else if(cmd.startsWith('MAIL')||cmd.startsWith('RCPT'))reply='250 ok';else if(cmd==='DATA\r\n')reply='354 go';else if(cmd.includes('Message-ID:')){if(mode==='lost'){controller.close();return;}reply=mode==='rejected'?'554 rejected':'250 accepted';}else throw Error('Unexpected command');controller.enqueue(new TextEncoder().encode(reply+'\r\n'));}});
   return {opened:Promise.resolve({}),readable,writable,close:async()=>{try{controller.close();}catch{}}};
  };
  if(mode==='accepted')assert.equal((await smtp(env,input,'<test@qq.com>',new Date().toUTCString())).acceptedBySmtp,true);
  else await assert.rejects(()=>smtp(env,input,'<test@qq.com>',new Date().toUTCString()),mode==='lost'?/SEND_OUTCOME_UNKNOWN/:/SMTP_REJECTED_554/);
  assert.equal(commands.filter(c=>c.includes('Message-ID:')).length,1);
 }
});
