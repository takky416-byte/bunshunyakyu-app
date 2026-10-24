#!/usr/bin/env python3
"""Build fixed Japanese male narration once; the game uses same-origin MP3s."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import ssl
import subprocess
import edge_tts
import edge_tts.communicate

ROOT = Path(__file__).resolve().parents[1]
VOICE = 'ja-JP-KeitaNeural'
# Honour the environment's verified CA store and proxy, without disabling TLS.
edge_tts.communicate._SSL_CTX = ssl.create_default_context()

async def main():
    raw = subprocess.check_output(['node', '--experimental-strip-types', '--input-type=module', '-e', 'import {voiceCatalog} from "./src/draftSpeech.ts";process.stdout.write(JSON.stringify(voiceCatalog()))'], cwd=ROOT)
    catalog = json.loads(raw)
    manifest = ROOT / 'src/maleVoice2026.json'
    previous = json.loads(manifest.read_text()) if manifest.exists() else {}
    processed = set(previous.get('clips', {}).values()) if previous.get('processing') == 'silence-trim-v1' else set()
    output = ROOT / 'public/audio/voice-male-v2'
    output.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(2)
    clips = {}; checked = 0
    async def generate(clause):
        nonlocal checked
        rate = '-16%' if clause['kind'] == 'name' else '+0%'
        key = clause['kind'] + '|' + clause['text']
        identity = hashlib.sha256((VOICE + rate + key).encode()).hexdigest()[:24]
        path = output / (identity + '.mp3')
        async with semaphore:
            if not path.exists() or path.stat().st_size < 1000:
                temporary = path.with_suffix('.tmp')
                for attempt in range(3):
                    try:
                        tts = edge_tts.Communicate(clause['text'], VOICE, rate=rate, proxy=os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy'))
                        await asyncio.wait_for(tts.save(str(temporary)), timeout=40)
                        if temporary.stat().st_size < 1000: raise ValueError('Empty speech clip')
                        temporary.replace(path)
                        break
                    except Exception:
                        temporary.unlink(missing_ok=True)
                        if attempt == 2: raise
                        await asyncio.sleep(1 + attempt)
            asset = '/audio/voice-male-v2/' + path.name
            if asset not in processed:
                trim_directory = ROOT / '.cache/voice-trim'
                trim_directory.mkdir(parents=True, exist_ok=True)
                trimmed = trim_directory / path.name
                command = ['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-af', 'silenceremove=start_periods=1:start_duration=0.03:start_threshold=-48dB,areverse,silenceremove=start_periods=1:start_duration=0.03:start_threshold=-48dB,areverse,afade=t=in:d=0.015', '-codec:a', 'libmp3lame', '-b:a', '96k', str(trimmed)]
                await asyncio.to_thread(subprocess.run, command, check=True)
                trimmed.replace(path)
            clips[key] = asset
            checked += 1
            if checked % 50 == 0: print(f'Male voice clips: {checked}/{len(catalog)}', flush=True)
    await asyncio.gather(*(generate(c) for c in catalog))
    result = {'version': 2, 'processing': 'silence-trim-v1', 'voice': VOICE, 'gender': 'Male', 'nameRate': '-16%', 'bodyRate': '+0%', 'clips': dict(sorted(clips.items()))}
    path = ROOT / 'src/maleVoice2026.json'
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)
    print(f'Male voice ready: {len(clips)} clips, {sum(p.stat().st_size for p in output.glob("*.mp3"))} bytes', flush=True)

if __name__ == '__main__':
    asyncio.run(main())
