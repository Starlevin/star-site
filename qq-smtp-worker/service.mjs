import { DurableObject } from 'cloudflare:workers';
import { validate, readJson, fingerprint } from './validation.mjs';
import { smtp } from './smtp.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function authorized(request, secret) {
  if(!secret)return false;
  const actual=request.headers.get('Authorization')||'';
  if(actual.length>1024)return false;
  const a=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(actual));
  const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('Bearer '+secret));
  return crypto.subtle.timingSafeEqual(a,b);
}
export class MailSender extends DurableObject {
  async fetch(request) {
    const input=validate(await request.json()), hash=await fingerprint(input);
    const reservation=await this.ctx.storage.transaction(async tx=>{
      const old=await tx.get('request'); if(old)return {old};
      const record={request_id:input.request_id,fingerprint:hash,state:'attempting',message_id:'<'+crypto.randomUUID()+'@qq.com>',created_at:new Date().toISOString(),date:new Date().toUTCString(),automaticRetry:false};
      await tx.put('request',record);return {record};
    });
    if(reservation.old){
      if(reservation.old.fingerprint!==hash)return json({error:'IDEMPOTENCY_CONFLICT',automaticRetry:false},409);
      // An interrupted attempt may already have reached QQ. Never re-enter SMTP for this key.
      const old=reservation.old, state=old.state==='attempting'?'unknown':old.state;
      const {fingerprint:_,date:__,...safe}=old;
      return json({...safe,state,deduplicated:true,requiresManualCheck:state==='unknown'},state==='accepted'?200:409);
    }
    const record=reservation.record;let accepted=false;
    try {
      await smtp(this.env,input,record.message_id,record.date);
      accepted=true;
      await this.ctx.storage.put('request',{...record,state:'accepted',accepted_at:new Date().toISOString()});
      return json({request_id:input.request_id,state:'accepted',message_id:record.message_id,acceptedBySmtp:true,automaticRetry:false});
    } catch(error) {
      const safeError=accepted||!/^SMTP_(?:CLOSED|PROTOCOL_ERROR|TIMEOUT|REJECTED_\d{3}|CONNECTION_FAILED)$|^MAIL_NOT_CONFIGURED$/.test(error.message)?'SEND_OUTCOME_UNKNOWN':error.message;
      const state=safeError==='SEND_OUTCOME_UNKNOWN'?'unknown':'failed';
      // If this write fails the durable attempting record remains a non-retryable tombstone.
      await this.ctx.storage.put('request',{...record,state,error:safeError});
      return json({request_id:input.request_id,state,error:safeError,message_id:record.message_id,automaticRetry:false,requiresManualCheck:state==='unknown'},502);
    }
  }
}
export default {async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/health'&&request.method==='GET')return json({service:'qq-mail-sender',version:'1.0.0'});
  if(request.method!=='POST'||!['/send','/probe'].includes(path))return json({error:'NOT_FOUND'},404);
  if(!env.RELAY_TOKEN||!env.QQ_EMAIL_ACCOUNT||!env.QQ_EMAIL_AUTH_CODE)return json({error:'SERVICE_NOT_CONFIGURED'},503);
  if(!await authorized(request,env.RELAY_TOKEN))return json({error:'UNAUTHORIZED'},401);
  if(path==='/probe'){try{return json(await smtp(env,null));}catch{return json({error:'SMTP_PROBE_FAILED'},502);}}
  let input;try{input=validate(await readJson(request));}catch(error){return json({error:error.message},400);}
  try{return await env.MAIL_SENDER.getByName(input.request_id).fetch(new Request('https://internal/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}));}
  catch{return json({error:'SEND_OUTCOME_UNKNOWN',automaticRetry:false,requiresManualCheck:true,request_id:input.request_id},503);}
}};
