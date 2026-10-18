// Private operator helper: all authentication arrives through an anonymous stdin pipe.
// Never print request headers, credentials, mailbox account, or SMTP auth responses.
import { fetch, ProxyAgent } from 'undici';
let raw=''; for await (const chunk of process.stdin) raw+=chunk;
const config=JSON.parse(raw);raw='';
const dispatcher=new ProxyAgent('http://127.0.0.1:7890');
try {
 const response=await fetch(config.url,{method:config.method||'POST',redirect:'manual',headers:{...(config.token?{Authorization:'Bearer '+config.token}:{}),...(config.siteToken?{'OAI-Sites-Authorization':'Bearer '+config.siteToken}:{}),'Content-Type':'application/json'},...(config.body?{body:JSON.stringify(config.body)}:{}),dispatcher,signal:AbortSignal.timeout(65000)});
 const text=await response.text();let result;try{result=JSON.parse(text);}catch{result={nonJson:true,length:text.length};}
 process.stdout.write(JSON.stringify({status:response.status,result}));
}catch(error){process.stdout.write(JSON.stringify({error:'OPERATOR_NETWORK_FAILURE',code:error.cause?.code||error.code||'UNKNOWN'}));process.exitCode=1;}
finally{await dispatcher.close();}
