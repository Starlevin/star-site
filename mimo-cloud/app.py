"""Private Xiaomi MiMo dubbing API. Secrets only via Render environment."""
import asyncio, json, os, hmac, hashlib, tempfile, time, uuid, threading
from pathlib import Path
from fastapi import FastAPI, Request, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from starlette.background import BackgroundTask
from mimo_dub import synthesize, dub, DEFAULT_VOICE, PRESET_VOICES

app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
STORE=Path(tempfile.gettempdir())/"mimo_private_audio"
STORE.mkdir(exist_ok=True)
LIMIT=threading.BoundedSemaphore(2)

def auth(req):
    key=os.getenv("MIMO_DUB_ACCESS_TOKEN","")
    supplied=req.headers.get("authorization","")
    if not key:
        raise HTTPException(503,"Private access not configured")
    if not supplied.lower().startswith("bearer ") or not hmac.compare_digest(key,supplied[7:].strip()):
        raise HTTPException(401,"Invalid access token",headers={"WWW-Authenticate":"Bearer"})

def validate(text,voice):
    if not isinstance(text,str) or not text.strip() or len(text)>2000:
        raise HTTPException(400,"Text length must be 1 to 2000")
    if voice not in PRESET_VOICES:
        raise HTTPException(400,"Unknown voice")

def signed_link(req,ident):
    exp=int(time.time())+3600
    sig=hmac.new(os.environ["MIMO_SIGNING_SECRET"].encode(),(ident+":"+str(exp)).encode(),hashlib.sha256).hexdigest()
    return str(req.base_url).rstrip("/")+"/media/"+ident+"?exp="+str(exp)+"&sig="+sig

async def run_limited(func,*args,**kwargs):
    if not LIMIT.acquire(False):raise HTTPException(429,"Busy; retry later")
    try:return await asyncio.to_thread(func,*args,**kwargs)
    finally:LIMIT.release()

@app.get("/health")
async def health():
    return {"status":"ok","version":"0.3.0","mimo_key_configured":bool(os.getenv("MIMO_API_KEY")),
            "protected":bool(os.getenv("MIMO_DUB_ACCESS_TOKEN"))}

@app.get("/",response_class=HTMLResponse)
def homepage():
    return """<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>MiMo 配音</title>
<style>body{font:16px system-ui;background:#0c1220;color:#e8edfa;margin:0}main{max-width:680px;margin:28px auto;padding:20px}section{background:#172135;border:1px solid #2e3d54;border-radius:16px;padding:20px;margin:18px 0}input,select,textarea,button{display:block;width:100%;box-sizing:border-box;margin:8px 0 16px;padding:11px;border-radius:9px;border:1px solid #3b4860;color:#fff;background:#0c1625;font:inherit}textarea{height:104px}button{background:#456cf0;border:0;cursor:pointer}small{color:#afbbcb}#out{white-space:pre-wrap}</style>
<main><h1>MiMo 私人配音</h1><small>后台已保存 MiMo 密钥。请填写单独的访问令牌，仅供自己调用。</small>
<section><label>私人访问令牌<input type="password" id="token" autocomplete="off"></label><label>音色<select id="voice"><option>茉莉</option><option>冰糖</option><option>苏打</option><option>白桦</option><option>Mia</option><option>Chloe</option></select></label></section>
<section><h3>文字转 WAV</h3><textarea id="text" placeholder="配音内容"></textarea><button onclick="speech()">生成语音</button></section>
<section><h3>视频配音</h3><input id="video" type="file" accept=".mp4"><label>可选 SRT 时间轴</label><textarea id="srt"></textarea><label>或提供解说文字</label><textarea id="script"></textarea><button onclick="video()">生成 MP4</button></section>
<section id="out">等待操作</section>
<script>
const get=id=>document.getElementById(id);
async function send(path,body,name){
let head={Authorization:"Bearer "+get("token").value};if(typeof body==="string")head["Content-Type"]="application/json";
let r=await fetch(path,{method:"POST",headers:head,body:body});
if(!r.ok){let j=await r.json().catch(()=>({}));throw new Error(j.detail||"HTTP "+r.status)}
let u=URL.createObjectURL(await r.blob());let a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),30000);get("out").textContent="已生成 "+name}
async function speech(){get("out").textContent="正在合成…";try{await send("/api/speech",JSON.stringify({text:get("text").value,voice:get("voice").value}),"mimo.wav")}catch(e){get("out").textContent=e.message}}
async function video(){get("out").textContent="正在处理视频…";try{let f=get("video").files[0];if(!f)throw Error("请选择 MP4 文件");
let b=new FormData();b.append("video",f);b.append("srt_text",get("srt").value);b.append("script",get("script").value);b.append("voice",get("voice").value);
await send("/api/dub",b,"mimo-dubbed.mp4")}catch(e){get("out").textContent=e.message}}
</script></main></html>"""

@app.post("/api/speech")
async def speech(req:Request):
    auth(req)
    data=await req.json()
    text=str(data.get("text","")).strip();voice=str(data.get("voice",DEFAULT_VOICE))
    validate(text,voice)
    tmp=tempfile.TemporaryDirectory(prefix="mimo_tts_")
    out=Path(tmp.name)/"voice.wav"
    try:
        await run_limited(synthesize,text,out,voice,str(data.get("style",""))[:400])
        return FileResponse(out,media_type="audio/wav",filename="mimo.wav",background=BackgroundTask(tmp.cleanup))
    except:
        tmp.cleanup()
        raise

@app.post("/api/dub")
async def upload(req:Request,video:UploadFile=File(...),srt_text:str=Form(""),script:str=Form(""),voice:str=Form(DEFAULT_VOICE)):
    auth(req)
    if not (video.filename or "").lower().endswith(".mp4"):raise HTTPException(400,"MP4 only")
    if voice not in PRESET_VOICES:raise HTTPException(400,"Unknown voice")
    if srt_text.strip() and script.strip():raise HTTPException(400,"Choose SRT or script")
    if len(srt_text)>90000 or len(script)>10000:raise HTTPException(413,"Script too large")
    tmp=tempfile.TemporaryDirectory(prefix="mimo_dub_")
    folder=Path(tmp.name);src=folder/"video.mp4"
    try:
        count=0
        with src.open("wb") as f:
            while True:
                part=await video.read(1024*1024)
                if not part:break
                count+=len(part)
                if count>40*1024*1024:raise HTTPException(413,"40MB limit")
                f.write(part)
        if not count:raise HTTPException(400,"Empty video")
        srt=None;txt=None
        if srt_text.strip():srt=folder/"captions.srt";srt.write_text(srt_text,encoding="utf-8")
        elif script.strip():txt=folder/"script.txt";txt.write_text(script,encoding="utf-8")
        output=folder/"dubbed.mp4"
        await run_limited(dub,src,subtitles=srt,script=txt,voice=voice,output=output)
        return FileResponse(output,media_type="video/mp4",filename="mimo-dubbed.mp4",background=BackgroundTask(tmp.cleanup))
    except:
        tmp.cleanup()
        raise

@app.get("/media/{ident}")
async def media(ident:str,exp:int,sig:str):
    if len(ident)!=32 or any(c not in "0123456789abcdef" for c in ident):raise HTTPException(404)
    if not (time.time()<exp<time.time()+3700):raise HTTPException(403)
    key=os.getenv("MIMO_SIGNING_SECRET","")
    val=hmac.new(key.encode(),(ident+":"+str(exp)).encode(),hashlib.sha256).hexdigest()
    if not key or not hmac.compare_digest(sig,val):raise HTTPException(403)
    p=STORE/(ident+".wav")
    if not p.is_file():raise HTTPException(404)
    return FileResponse(p,media_type="audio/wav",filename="mimo.wav")

TOOL={"name":"synthesize_speech","description":"Use Xiaomi MiMo TTS to produce WAV from text, returning a signed 60-minute audio download link.",
      "inputSchema":{"type":"object","required":["text"],"properties":{"text":{"type":"string","maxLength":2000},"voice":{"type":"string","default":"茉莉"},"style":{"type":"string"}}}}
@app.post("/mcp")
async def mcp(req:Request):
    auth(req)
    data=await req.json()
    method=data.get("method");rid=data.get("id")
    if rid is None:return JSONResponse({},status_code=202)
    if method=="initialize":res={"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"mimo-dubber","version":"0.3.0"}}
    elif method=="ping":res={}
    elif method=="tools/list":res={"tools":[TOOL]}
    elif method=="tools/call":
        p=data.get("params") or {};args=p.get("arguments") or {}
        if p.get("name")!="synthesize_speech":
            res={"content":[{"type":"text","text":"Unknown tool"}],"isError":True}
        else:
            try:
                t=str(args.get("text","")).strip();v=str(args.get("voice",DEFAULT_VOICE));style=str(args.get("style",""))
                validate(t,v)
                ident=uuid.uuid4().hex
                await run_limited(synthesize,t,STORE/(ident+".wav"),v,style[:400])
                r={"voice":v,"audio_url":signed_link(req,ident)}
                res={"content":[{"type":"text","text":json.dumps(r,ensure_ascii=False)}],"isError":False}
            except Exception as e:
                res={"content":[{"type":"text","text":type(e).__name__+": "+str(e)[:160]}],"isError":True}
    else:return {"jsonrpc":"2.0","id":rid,"error":{"code":-32601,"message":"Method not found"}}
    return {"jsonrpc":"2.0","id":rid,"result":res}
