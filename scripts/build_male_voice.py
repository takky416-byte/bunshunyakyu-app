#!/usr/bin/env python3
"""Build a deeper male voice with independently controlled name speed."""
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
PROCESSING = 'baritone-v3'
PITCH_SEMITONES = -3
PITCH_SCALE = 2 ** (PITCH_SEMITONES / 12)
edge_tts.communicate._SSL_CTX = ssl.create_default_context()

async def main():
    raw = subprocess.check_output(['node', '--experimental-strip-types', '--input-type=module', '-e', 'import {voiceCatalog} from "./src/draftSpeech.ts";process.stdout.write(JSON.stringify(voiceCatalog()))'], cwd=ROOT)
    catalog = json.loads(raw)
    original = json.loads((ROOT / 'scripts/voice-source-v2.json').read_text())
    output = ROOT / 'public/audio/voice-male-v3'
    cache = ROOT / '.cache/voice-baritone-v3'
    output.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(3)
    clips = {}; checked = 0
    async def generate(clause):
        nonlocal checked
        key = clause['kind'] + '|' + clause['text']
        identity = hashlib.sha256((PROCESSING + VOICE + str(PITCH_SEMITONES) + str(clause['rate']) + key).encode()).hexdigest()[:24]
        path = output / (identity + '.mp3')
        async with semaphore:
            if not path.exists() or path.stat().st_size < 1000:
                old_asset = original['clips'].get(key)
                if old_asset and (ROOT / ('public' + old_asset)).exists():
                    source = ROOT / ('public' + old_asset)
                    source_rate = 0.84 if clause['kind'] == 'name' else 1
                else:
                    source = cache / (identity + '.raw.mp3')
                    source_rate = 1
                    if not source.exists():
                        for attempt in range(3):
                            try:
                                temporary = source.with_suffix('.tmp')
                                tts = edge_tts.Communicate(clause['text'], VOICE, rate='+0%', proxy=os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy'))
                                await asyncio.wait_for(tts.save(str(temporary)), timeout=40)
                                if temporary.stat().st_size < 1000: raise ValueError('Empty speech clip')
                                temporary.replace(source)
                                break
                            except Exception:
                                temporary.unlink(missing_ok=True)
                                if attempt == 2: raise
                                await asyncio.sleep(1 + attempt)
                tempo = clause['rate'] / source_rate
                filters = f'silenceremove=start_periods=1:start_duration=0.03:start_threshold=-48dB,areverse,silenceremove=start_periods=1:start_duration=0.03:start_threshold=-48dB,areverse,rubberband=tempo={tempo}:pitch={PITCH_SCALE}:formant=preserved:pitchq=quality:transients=smooth,afade=t=in:d=0.02'
                temporary = cache / path.name
                command = ['ffmpeg', '-v', 'error', '-y', '-threads', '1', '-filter_threads', '1', '-i', str(source), '-af', filters, '-codec:a', 'libmp3lame', '-b:a', '96k', str(temporary)]
                await asyncio.to_thread(subprocess.run, command, check=True)
                if temporary.stat().st_size < 1000: raise ValueError('Processed voice clip is empty')
                temporary.replace(path)
            clips[key] = '/audio/voice-male-v3/' + path.name
            checked += 1
            if checked % 100 == 0: print(f'Baritone voice clips: {checked}/{len(catalog)}', flush=True)
    await asyncio.gather(*(generate(c) for c in catalog))
    result = {'version': 3, 'processing': PROCESSING, 'voice': VOICE, 'gender': 'Male', 'pitchSemitones': PITCH_SEMITONES, 'nameRate': '-50%', 'bodyRate': '+0%', 'clips': dict(sorted(clips.items()))}
    path = ROOT / 'src/maleVoice2026.json'
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)
    print(f'Baritone voice ready: {len(clips)} clips, {sum(p.stat().st_size for p in output.glob("*.mp3"))} bytes', flush=True)

if __name__ == '__main__':
    asyncio.run(main())
