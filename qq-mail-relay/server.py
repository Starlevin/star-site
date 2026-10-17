"""QQ IMAP HTTPS relay. Deploy behind a managed HTTPS ingress; never expose this HTTP port directly."""
import os, json, ssl, imaplib, email, secrets, threading, re
from email import policy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
TOKEN = os.environ['QQ_RELAY_TOKEN']
ACCOUNT = os.environ['QQ_EMAIL_ACCOUNT']
AUTH_CODE = os.environ['QQ_EMAIL_AUTH_CODE']
if len(TOKEN) < 32:
    raise RuntimeError('QQ_RELAY_TOKEN must have at least 32 characters')
SLOTS = threading.BoundedSemaphore(4)

def number(value, low=1, high=4294967295):
    if type(value) is not int or not low <= value <= high:
        raise ValueError('INVALID_ARGUMENTS')
    return value

def execute(tool, args):
    schemas = {'list_emails': {'limit','before_uid'}, 'search_emails': {'keyword','limit'}, 'read_email': {'uid','uidvalidity'}}
    if tool not in schemas or not isinstance(args,dict) or set(args)-schemas[tool]:
        raise ValueError('INVALID_ARGUMENTS')
    limit=number(args.get('limit',20),1,50)
    if 'before_uid' in args: number(args['before_uid'])
    if tool == 'search_emails':
        kw=args.get('keyword')
        if not isinstance(kw,str) or not kw.strip() or len(kw)>200 or any(c in kw for c in '\r\n\0'):
            raise ValueError('INVALID_ARGUMENTS')
    if tool == 'read_email':
        number(args.get('uid'))
        if not isinstance(args.get('uidvalidity'),str) or not re.fullmatch(r'[0-9]+',args['uidvalidity']):
            raise ValueError('INVALID_ARGUMENTS')
    with imaplib.IMAP4_SSL('imap.qq.com',993,ssl_context=ssl.create_default_context(),timeout=15) as im:
        im.login(ACCOUNT,AUTH_CODE)
        # QQ may require an IMAP ID command. Do not send credentials in ID.
        imaplib.Commands.setdefault('ID',('AUTH',))
        try: im._simple_command('ID','("name" "QQ Mail Readonly Relay" "version" "1.0")')
        except imaplib.IMAP4.error: pass
        typ,_=im.select('INBOX',readonly=True)  # EXAMINE, never SELECT for writes
        if typ!='OK': raise ValueError('MAILBOX_UNAVAILABLE')
        uv=im.response('UIDVALIDITY')[1]
        if not uv or not uv[0]: raise ValueError('UIDVALIDITY_UNAVAILABLE')
        validity=uv[0].decode('ascii')
        if tool=='read_email':
            if validity!=args['uidvalidity']: raise ValueError('MAILBOX_CHANGED_REFRESH_LIST')
            uid=args['uid']
            typ,size=im.uid('fetch',str(uid),'(RFC822.SIZE)')
            joined=b' '.join(x for x in size if isinstance(x,bytes))
            match=re.search(rb'RFC822.SIZE (\d+)',joined)
            if typ!='OK' or not match: raise ValueError('EMAIL_NOT_FOUND')
            if int(match[1])>2_000_000: raise ValueError('EMAIL_TOO_LARGE')
            typ,data=im.uid('fetch',str(uid),'(BODY.PEEK[])')
            literal=next((x[1] for x in data if isinstance(x,tuple)),None)
            if typ!='OK' or literal is None: raise ValueError('EMAIL_NOT_FOUND')
            msg=email.message_from_bytes(literal,policy=policy.default)
            part=msg.get_body(preferencelist=('plain','html')) if msg.is_multipart() else msg
            body=''
            if part and part.get_content_maintype()=='text' and part.get_content_disposition()!='attachment':
                body=part.get_content()
            return {'uid':uid,'uidvalidity':validity,'subject':str(msg.get('Subject',''))[:2000],'from':str(msg.get('From',''))[:2000],'date':str(msg.get('Date',''))[:2000],'body':body[:60000],'content_type':part.get_content_type() if part else None,'truncated':len(body)>60000,'untrusted_content':True}
        if tool=='search_emails':
            # RFC 3501 quoted string, validated to exclude CR/LF/NUL.
            quoted='"'+kw.replace('\\','\\\\').replace('"','\\"')+'"'
            typ,data=im.uid('search','CHARSET','UTF-8','TEXT',quoted.encode('utf-8'))
            if typ!='OK': raise ValueError('SEARCH_CHARSET_OR_QUERY_UNSUPPORTED')
        else: typ,data=im.uid('search',None,'ALL')
        if typ!='OK': raise ValueError('SEARCH_FAILED')
        ids=sorted((int(x) for x in data[0].split()),reverse=True)
        if 'before_uid' in args: ids=[x for x in ids if x<args['before_uid']]
        chosen=ids[:limit]; rows=[]
        for uid in chosen:
            typ,data=im.uid('fetch',str(uid),'(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)]<0.16384>)')
            raw=next((x[1] for x in data if isinstance(x,tuple)),None)
            if typ!='OK' or raw is None: continue
            msg=email.message_from_bytes(raw,policy=policy.default)
            rows.append({'uid':uid,'uidvalidity':validity,'subject':str(msg.get('Subject',''))[:2000],'from':str(msg.get('From',''))[:2000],'date':str(msg.get('Date',''))[:2000]})
        return {'emails':rows,'uidvalidity':validity,'next_before_uid':chosen[-1] if len(ids)>limit else None,'untrusted_content':True}

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass  # never log headers or email data
    def do_GET(self):
        if self.path == "/healthz": return self.reply(200,{"status":"ok"})
        return self.reply(404,{"error":"NOT_FOUND"})
    def do_POST(self):
        if self.path!='/v1/mail': return self.reply(404,{'error':'NOT_FOUND'})
        auth=self.headers.get('Authorization','')
        if not secrets.compare_digest(auth.encode(),('Bearer '+TOKEN).encode()): return self.reply(401,{'error':'UNAUTHORIZED'})
        if not SLOTS.acquire(blocking=False): return self.reply(429,{'error':'BUSY'})
        try:
            self.connection.settimeout(30)
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=8192: return self.reply(400,{'error':'INVALID_REQUEST'})
            b=json.loads(self.rfile.read(length))
            result=execute(b.get('tool'),b.get('arguments',{}))
            self.reply(200,result)
        except imaplib.IMAP4.error:
            self.reply(502,{'error':'IMAP_AUTH_OR_PROTOCOL_FAILED'})
        except (TimeoutError, OSError):
            self.reply(502,{'error':'IMAP_TLS_OR_NETWORK_FAILED'})
        except ValueError as e:
            allowed={'INVALID_ARGUMENTS','MAILBOX_UNAVAILABLE','UIDVALIDITY_UNAVAILABLE','MAILBOX_CHANGED_REFRESH_LIST','EMAIL_NOT_FOUND','EMAIL_TOO_LARGE','SEARCH_CHARSET_OR_QUERY_UNSUPPORTED','SEARCH_FAILED'}
            self.reply(400,{'error':str(e) if str(e) in allowed else 'INVALID_REQUEST'})
        except Exception:
            self.reply(502,{'error':'IMAP_REQUEST_FAILED'}) # no upstream exception text or secrets
        finally: SLOTS.release()
    def reply(self,status,data):
        raw=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Cache-Control','no-store'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)

if __name__=='__main__':
    ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('PORT','8080'))),Handler).serve_forever()
