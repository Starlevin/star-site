import { connect } from 'cloudflare:sockets';
import { address } from './validation.mjs';
const encode = new TextEncoder();
const b64 = value => { let s=''; for (const b of encode.encode(value)) s+=String.fromCharCode(b); return btoa(s); };
const folded = value => b64(value).match(/.{1,76}/g).join('\r\n');
export function message(env, input, messageId, date) {
  // Each encoded word stays below RFC 2047's 75-character limit, split at Unicode code points.
  const words=[]; let part='';
  for (const char of input.subject) { if (encode.encode(part+char).length>42) { words.push('=?UTF-8?B?'+b64(part)+'?='); part=''; } part+=char; }
  if (part) words.push('=?UTF-8?B?'+b64(part)+'?=');
  return ['From: '+env.QQ_EMAIL_ACCOUNT,'To: '+input.to.join(',\r\n '),'Subject: '+words.join('\r\n '),'Date: '+date,'Message-ID: '+messageId,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',folded(input.text)].join('\r\n');
}
export async function smtp(env, input, messageId, date) {
  if (!address(env.QQ_EMAIL_ACCOUNT) || !env.QQ_EMAIL_ACCOUNT.toLowerCase().endsWith('@qq.com') || !env.QQ_EMAIL_AUTH_CODE) throw Error('MAIL_NOT_CONFIGURED');
  // Implicit TLS validates smtp.qq.com's certificate. No insecure TLS option or plaintext fallback.
  const socket=connect({hostname:'smtp.qq.com',port:465},{secureTransport:'on'});
  let timer, phase='connecting', accepted=false;
  try {
    return await Promise.race([(async()=>{
      await socket.opened;
      const reader=socket.readable.getReader(), writer=socket.writable.getWriter(), decoder=new TextDecoder(); let buffer='';
      async function line() { while (!buffer.includes('\r\n')) { const r=await reader.read(); if(r.done)throw Error('SMTP_CLOSED'); buffer+=decoder.decode(r.value,{stream:true}); if(buffer.length>65536)throw Error('SMTP_PROTOCOL_ERROR'); } const i=buffer.indexOf('\r\n');const result=buffer.slice(0,i);buffer=buffer.slice(i+2);return result; }
      async function response(expected) { const first=await line(), m=/^(\d{3})([ -])/.exec(first);if(!m)throw Error('SMTP_PROTOCOL_ERROR'); if(m[2]==='-'){let count=0;while(true){const next=await line();if(next.startsWith(m[1]+' '))break;if(!next.startsWith(m[1]+'-')||++count>100)throw Error('SMTP_PROTOCOL_ERROR');}} const code=Number(m[1]); if(!expected.includes(code))throw Error('SMTP_REJECTED_'+code);return code; }
      async function command(text,codes){await writer.write(encode.encode(text+'\r\n'));return response(codes);}
      await response([220]);await command('EHLO qq-mail-assistant.workers.dev',[250]);
      await command('AUTH LOGIN',[334]);await command(b64(env.QQ_EMAIL_ACCOUNT),[334]);await command(b64(env.QQ_EMAIL_AUTH_CODE),[235]);
      if(!input){await command('QUIT',[221]);return {tlsVerified:true,smtpAuthenticated:true};}
      phase='envelope';await command('MAIL FROM:<'+env.QQ_EMAIL_ACCOUNT+'>',[250]);
      for(const to of input.to)await command('RCPT TO:<'+to+'>',[250,251]);
      await command('DATA',[354]);phase='data';
      await writer.write(encode.encode(message(env,input,messageId,date)+'\r\n.\r\n'));
      try { await response([250]); } catch(error) { if(/^SMTP_REJECTED_[45]\d\d$/.test(error.message))phase='rejected';throw error; }
      accepted=true;return {acceptedBySmtp:true};
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('SMTP_TIMEOUT')),25000);})]);
  } catch(error) {
    if(accepted)return {acceptedBySmtp:true};
    const safe=/^(SMTP_(?:CLOSED|PROTOCOL_ERROR|TIMEOUT|REJECTED_\d{3})|MAIL_NOT_CONFIGURED)$/.test(error.message)?error.message:'SMTP_CONNECTION_FAILED';
    throw Error(phase==='data'?'SEND_OUTCOME_UNKNOWN':safe);
  } finally {clearTimeout(timer);socket.close().catch(()=>{});}
}
