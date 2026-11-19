#!/usr/bin/env python3
"""MiMo TTS + ASR video dubber. Only standard library; ffmpeg required for video.

All credentials are read at runtime from environment variables, never written to disk.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import wave
from array import array

API_URL = "https://api.xiaomimimo.com/v1/chat/completions"
SR = 24000
PRESET_VOICES = ("冰糖", "茉莉", "苏打", "白桦", "Mia", "Chloe", "Milo", "Dean")
DEFAULT_VOICE = "茉莉"
MAX_ASR_BYTES = 7_000_000  # conservative before base64 expansion (<10 MB)


class MiMoError(RuntimeError):
    pass


def api_request(payload: dict) -> dict:
    key = os.environ.get("MIMO_API_KEY", "").strip()
    if not key:
        raise MiMoError("MIMO_API_KEY 环境变量未配置。请用新密钥在本机安全设置，不要在聊天中发送。")
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "api-key": key},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        # Never print request headers, body, or raw error content.
        raise MiMoError(f"MiMo API HTTP {exc.code}；请检查密钥、模型、配额和格式。") from exc
    except urllib.error.URLError as exc:
        raise MiMoError(f"MiMo API 连接失败：{exc.reason}") from exc


def synthesize(text: str, output: Path, voice: str = DEFAULT_VOICE, style: str = "") -> Path:
    text = text.strip()
    if not text:
        raise ValueError("要合成的文本不能为空")
    if len(text) > 3500:
        raise ValueError("单段文本超过 3500 字符，请拆成多段")
    if voice not in PRESET_VOICES:
        raise ValueError(f"未知预置音色：{voice}；请从 {PRESET_VOICES} 中选择")
    messages = []
    if style.strip():
        messages.append({"role": "user", "content": style.strip()})
    messages.append({"role": "assistant", "content": text})
    response = api_request({
        "model": "mimo-v2.5-tts", "messages": messages,
        "audio": {"format": "wav", "voice": voice},
        "stream": False,
    })
    try:
        audio = response["choices"][0]["message"]["audio"]["data"]
        binary = base64.b64decode(audio, validate=True)
    except (IndexError, KeyError, TypeError, ValueError) as exc:
        raise MiMoError("MiMo TTS 响应缺少预期的 audio.data") from exc
    if not binary.startswith(b"RIFF"):
        raise MiMoError("MiMo 返回的音频没有 WAV 文件头")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(binary)
    return output


def transcribe(audio_path: Path, language: str = "auto") -> str:
    suffix = audio_path.suffix.lower()
    mime = "audio/mpeg" if suffix == ".mp3" else "audio/wav"
    if suffix not in (".mp3", ".wav"):
        raise ValueError("ASR 仅支持 WAV 或 MP3 文件")
    data = audio_path.read_bytes()
    if len(data) > MAX_ASR_BYTES:
        raise ValueError("语音片段超过大小限制，请先切片或压缩")
    dataurl = f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"
    response = api_request({
        "model": "mimo-v2.5-asr",
        "messages": [{"role": "user", "content": [{"type": "input_audio", "input_audio": {"data": dataurl}}]}],
        "asr_options": {"language": language},
        "stream": False,
    })
    try:
        result = response["choices"][0]["message"]["content"]
    except (KeyError, TypeError, IndexError) as exc:
        raise MiMoError("MiMo ASR 响应没有找到转写文本") from exc
    if isinstance(result, str):
        return result.strip()
    raise MiMoError("ASR 响应格式未知")


def run(*args: str, capture: bool = False) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(args, check=True, stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                              stderr=subprocess.PIPE, text=False)
    except FileNotFoundError as exc:
        raise MiMoError(f"缺少系统命令：{args[0]}，请安装 FFmpeg/FFprobe 并加入 PATH") from exc
    except subprocess.CalledProcessError as exc:
        error = exc.stderr.decode("utf-8", "replace")[-1000:]
        raise MiMoError(f"媒体处理失败：{error}") from exc


def video_duration(video: Path) -> float:
    p = run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(video), capture=True)
    try:
        secs = float(p.stdout.decode().strip())
    except ValueError as exc:
        raise MiMoError("无法读取视频时长") from exc
    if not math.isfinite(secs) or secs <= 0:
        raise MiMoError("视频时长无效")
    return secs


def parse_timestamp(ts: str) -> float:
    h, m, s, ms = re.split(r"[:,.]", ts)
    return int(h)*3600 + int(m)*60 + int(s) + int(ms.ljust(3,"0")[:3])/1000


def format_timestamp(sec: float) -> str:
    ms = int(round(sec*1000)); h,rem=divmod(ms,3600000); m,rem=divmod(rem,60000); s,ms=divmod(rem,1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def read_srt(path: Path) -> list[tuple[float,float,str]]:
    content = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
    pat = re.compile(r"(?m)(\d\d:\d\d:\d\d[,\.]\d{1,3})\s*-->\s*(\d\d:\d\d:\d\d[,\.]\d{1,3})[^\n]*\n((?:(?!\n\s*\n)[\s\S])*)")
    out=[]
    for match in pat.finditer(content):
        start, end = map(parse_timestamp, match.group(1,2))
        text = re.sub(r"<[^>]*>", "", match.group(3)).strip().replace("\n", " ")
        if text and end>start:
            out.append((start,end,text))
    if not out:
        raise ValueError("SRT 没有有效的字幕时间码")
    return out


def write_srt(segments: list[tuple[float,float,str]], path: Path) -> None:
    path.write_text("\n\n".join(f"{i}\n{format_timestamp(a)} --> {format_timestamp(b)}\n{txt}"
                    for i,(a,b,txt) in enumerate(segments,1)) + "\n", encoding="utf-8")


def automatic_segments(video: Path, duration: float, work: Path, chunk: float = 15.0) -> list[tuple[float,float,str]]:
    segments = []
    for i in range(math.ceil(duration/chunk)):
        start = i*chunk; end=min(duration,(i+1)*chunk)
        sample = work/f"asr_{i:03d}.mp3"
        run("ffmpeg","-hide_banner","-loglevel","error","-y","-ss",str(start),"-t",str(end-start),
            "-i",str(video),"-vn","-ac","1","-ar","16000","-b:a","48k",str(sample))
        txt = transcribe(sample)
        if txt:
            segments.append((start,end,txt))
    return segments



def segments_from_script(script: str, duration: float) -> list[tuple[float, float, str]]:
    """Produce approximate narration windows for original scripts (without ASR).

    Prefers explicit line breaks. Single-paragraph scripts are split at Chinese/
    English sentence punctuation, with allocated intervals proportional to length.
    For precise pacing and silent holds, provide an SRT instead.
    """
    script = script.strip()
    if not script:
        raise ValueError("解说脚本为空")
    lines = [line.strip() for line in script.splitlines() if line.strip()]
    if len(lines) == 1:
        lines = [t.strip() for t in re.split(r"(?<=[。！？!?；;])\s*", lines[0]) if t.strip()]
    if not lines:
        raise ValueError("无法从脚本提取有效台词")
    if any(len(line) > 3500 for line in lines):
        raise ValueError("脚本含过长片段；单段最多 3500 字符")
    weights = [max(5, len(t)) for t in lines]
    remaining = float(sum(weights))
    at = 0.0
    out = []
    for index, (line, weight) in enumerate(zip(lines, weights)):
        end = duration if index == len(lines) - 1 else at + duration * weight / remaining
        end = min(duration, end)
        if end > at:
            out.append((at, end, line))
        at = end
    return out


def decode_pcm_wav(wav_path: Path, work: Path, name: str) -> array:
    raw = work/(name+".raw")
    run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav_path),
        "-vn", "-ar", str(SR), "-ac", "1", "-f", "s16le", str(raw))
    values = array('h'); values.frombytes(raw.read_bytes())
    if sys.byteorder != "little":
        values.byteswap()
    return values


def voice_track(segments: list[tuple[float,float,str]], duration: float, voice: str,
                style: str, work: Path, dest: Path) -> None:
    # 16-bit mono buffer; overlap mixing with saturation.
    total = max(1,int(math.ceil(duration*SR)))
    output = array('h', [0]) * total
    for i,(start,end,text) in enumerate(segments,1):
        if not text.strip():
            continue
        wav = work/f"voice_{i:03d}.wav"
        synthesize(text,wav,voice,style)
        pcm = decode_pcm_wav(wav,work,f"v_{i:03d}")
        slot = max(1,int((end-start)*SR))
        # Adaptive acceleration when speech would run beyond the intended subtitle window.
        # A hard limit at 2.0x avoids extremely unnatural speech; extra tail is truncated.
        if len(pcm) > slot:
            rate = min(2.0, len(pcm)/slot)
            adjusted = work/f"adjust_{i:03d}.wav"
            run("ffmpeg","-hide_banner","-loglevel","error","-y","-i",str(wav),
                "-af",f"atempo={rate:.4f}","-ar",str(SR),"-ac","1",str(adjusted))
            pcm = decode_pcm_wav(adjusted,work,f"a_{i:03d}")
        position = int(start*SR)
        for j,value in enumerate(pcm[:min(slot,total-position)]):
            idx=position+j
            if idx>=total:break
            output[idx]=max(-32768,min(32767,output[idx]+value))
    with wave.open(str(dest),"wb") as writer:
        writer.setnchannels(1);writer.setsampwidth(2);writer.setframerate(SR)
        if sys.byteorder != "little":
            output.byteswap()
        writer.writeframes(output.tobytes())


def dub(video: Path, subtitles: Path | None = None, voice: str = DEFAULT_VOICE, style: str = "",
        original_volume: float = .12, output: Path | None = None, script: Path | None = None) -> dict[str,str]:
    video = video.expanduser().resolve()
    if not video.is_file():
        raise FileNotFoundError(f"视频路径不存在：{video}")
    if subtitles and script:
        raise ValueError("--subtitles 与 --script 只能选择一种输入方式")
    if not 0 <= original_volume <= 1:
        raise ValueError("original_volume 必须在 0 到 1 之间")
    duration=video_duration(video)
    output = (output or video.with_name(video.stem+"_dubbed.mp4")).expanduser().resolve()
    if output == video:
        raise ValueError("输出文件不得覆盖原视频")
    output.parent.mkdir(parents=True,exist_ok=True)
    stem=output.with_suffix("")
    narration=stem.with_name(stem.name+"_narration.wav")
    transcript=stem.with_name(stem.name+"_transcript.srt")
    with tempfile.TemporaryDirectory(prefix="mimo_dub_") as tmp:
        work=Path(tmp)
        if subtitles:
            segments = read_srt(subtitles.expanduser().resolve())
        elif script:
            segments = segments_from_script(script.expanduser().resolve().read_text(encoding="utf-8-sig"), duration)
        else:
            segments = automatic_segments(video,duration,work)
        if not segments:
            raise MiMoError("未提取出有效台词；请提供文字稿或 SRT 文件")
        write_srt(segments,transcript)
        voice_track(segments,duration,voice,style,work,narration)
        if original_volume == 0:
            # Input video may or may not have an audio track; map synthetic narration.
            run("ffmpeg","-hide_banner","-loglevel","error","-y","-i",str(video),"-i",str(narration),
                "-map","0:v:0","-map","1:a:0","-c:v","copy","-c:a","aac","-shortest",str(output))
        else:
            # If no original audio stream, keep narration only.
            probe=run("ffprobe","-v","error","-select_streams","a","-show_entries","stream=index","-of","csv=p=0",str(video),capture=True)
            if probe.stdout.strip():
                run("ffmpeg","-hide_banner","-loglevel","error","-y","-i",str(video),"-i",str(narration),
                    "-filter_complex",f"[0:a:0]volume={original_volume:.4f}[bg];[bg][1:a:0]amix=inputs=2:duration=longest:dropout_transition=0[a]",
                    "-map","0:v:0","-map","[a]","-c:v","copy","-c:a","aac","-shortest",str(output))
            else:
                run("ffmpeg","-hide_banner","-loglevel","error","-y","-i",str(video),"-i",str(narration),
                    "-map","0:v:0","-map","1:a:0","-c:v","copy","-c:a","aac","-shortest",str(output))
    return {"video":str(output),"narration":str(narration),"transcript":str(transcript),"timing": "srt" if subtitles else "chunk-estimated"}


def main() -> None:
    p=argparse.ArgumentParser(description="MiMo ASR/TTS dubbing CLI")
    sub=p.add_subparsers(dest="task",required=True)
    a=sub.add_parser("speech",help="Text-to-WAV")
    a.add_argument("--text",required=True);a.add_argument("--output",required=True)
    a.add_argument("--voice",default=DEFAULT_VOICE,choices=PRESET_VOICES);a.add_argument("--style",default="")
    b=sub.add_parser("dub",help="Video-to-dubbed MP4")
    b.add_argument("--video",required=True);b.add_argument("--subtitles");b.add_argument("--script")
    b.add_argument("--voice",default=DEFAULT_VOICE,choices=PRESET_VOICES);b.add_argument("--style",default="")
    b.add_argument("--original-volume",type=float,default=.12);b.add_argument("--output")
    c=sub.add_parser("transcribe",help="Audio-to-text")
    c.add_argument("--audio",required=True);c.add_argument("--language",default="auto",choices=["auto","zh","en"])
    args=p.parse_args()
    try:
        if args.task=="speech":
            print(json.dumps({"audio":str(synthesize(args.text,Path(args.output),args.voice,args.style))},ensure_ascii=False))
        elif args.task=="dub":
            print(json.dumps(dub(Path(args.video), Path(args.subtitles) if args.subtitles else None,
                                 args.voice,args.style,args.original_volume,Path(args.output) if args.output else None,
                                 Path(args.script) if args.script else None),ensure_ascii=False))
        else:print(transcribe(Path(args.audio),args.language))
    except (MiMoError,ValueError,OSError) as exc:
        print(f"错误：{exc}",file=sys.stderr)
        sys.exit(1)


if __name__=="__main__":main()
