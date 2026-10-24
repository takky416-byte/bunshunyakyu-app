#!/usr/bin/env python3
"""Build natural male narration, without pitch shifting or time stretching."""
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
PROCESSING = 'natural-v4'
edge_tts.communicate._SSL_CTX = ssl.create_default_context()

async def main():
    raw = subprocess.check_output(['node', '--experimental-strip-types', '--input-type=module', '-e', 'import {voiceCatalog} from "./src/draftSpeech.ts";process.stdout.write(JSON.stringify(voiceCatalog()))'], cwd=ROOT)
    catalog = json.loads(raw)
    original = json.loads((ROOT / 'scripts/voice-source-v2.json').read_text())
    output = ROOT / 'public/audio/voice-male-v4'
    cache = ROOT / '.cache/voice-natural-v4'
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(3)
    clips = {}; checked = 0
    async def generate(clause):
        nonlocal checked
        key = clause['kind'] + '|' + clause['text']
        identity = hashlib.sha256((PROCESSING + VOICE + key).encode()).hexdigest()[:24]
        path = output / (identity + '.mp3')
        async with semaphore:
            if not path.exists() or path.stat().st_size < 1000:
                old_asset = original['clips'].get(key) if clause['kind'] == 'body' else None
                if old_asset and (ROOT / ('public' + old_asset)).exists():
                    # Original v2 body recordings use the unmodified neural voice.
                    source = ROOT / ('public' + old_asset)
                    path.write_bytes(source.read_bytes())
                else:
                    source = cache / (identity + '.raw.mp3')
                    if not source.exists():
                        for attempt in range(3):
                            try:
                                temporary = source.with_suffix('.tmp')
                                tts = edge_tts.Communicate(clause['text'], VOICE, rate='+0%', pitch='+0Hz', proxy=os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy'))
                                await asyncio.wait_for(tts.save(str(temporary)), timeout=40)
                                if temporary.stat().st_size < 1000: raise ValueError('Empty speech clip')
                                temporary.replace(source)
                                break
                            except Exception:
                                temporary.unlink(missing_ok=True)
                                if attempt == 2: raise
                                await asyncio.sleep(1 + attempt)
                    # Only edge silence and tiny fades are adjusted. No doubling,
                    # reverb, pitch shift, or tempo/formant processing on speech.
                    filters = 'silenceremove=start_periods=1:start_duration=0.03:start_threshold=-48dB,areverse,silenceremove=start_periods=1:start_duration=0.03:start_threshold=-48dB,areverse,afade=t=in:d=0.015'
                    temporary = cache / path.name
                    command = ['ffmpeg', '-v', 'error', '-y', '-threads', '1', '-filter_threads', '1', '-i', str(source), '-af', filters, '-codec:a', 'libmp3lame', '-b:a', '96k', str(temporary)]
                    await asyncio.to_thread(subprocess.run, command, check=True)
                    if temporary.stat().st_size < 1000: raise ValueError('Processed voice clip is empty')
                    temporary.replace(path)
            clips[key] = '/audio/voice-male-v4/' + path.name
            checked += 1
            if checked % 100 == 0: print(f'Natural voice clips: {checked}/{len(catalog)}', flush=True)
    await asyncio.gather(*(generate(c) for c in catalog))
    result = {'version': 4, 'processing': PROCESSING, 'voice': VOICE, 'gender': 'Male', 'pitchSemitones': 0, 'nameRate': '+0%', 'bodyRate': '+0%', 'nameSeparator': '、', 'clips': dict(sorted(clips.items()))}
    path = ROOT / 'src/maleVoice2026.json'
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)
    print(f'Natural voice ready: {len(clips)} clips, {sum(p.stat().st_size for p in output.glob("*.mp3"))} bytes', flush=True)

if __name__ == '__main__':
    asyncio.run(main())
