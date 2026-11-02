#!/usr/bin/env python
"""Score STT engines on the clips in bakeoff/clips against bakeoff/phrases.txt. See README.md.

    bakeoff.py [engine ...]     engines: whisper moonshine parakeet (default: all)
"""
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

import jiwer

HERE = Path(__file__).parent
CLIPS = sorted((HERE / 'clips').glob('*.wav'))
PHRASES = [l.strip() for l in (HERE / 'phrases.txt').read_text().splitlines() if l.strip()]
WHISPER_URL = os.environ.get('PEAK_WHISPER_URL', 'http://127.0.0.1:8178')

# The wake-word gate (senses/heardFilter.js) already accepts these spellings of "Peak", so they are not errors here.
WAKE_VARIANTS = re.compile(r"\b(peek|peake|pete|pique|peke|beak)\b", re.I)
_norm = jiwer.Compose([jiwer.ToLowerCase(), jiwer.RemovePunctuation(), jiwer.RemoveMultipleSpaces(), jiwer.Strip()])
normalize = lambda s: _norm(WAKE_VARIANTS.sub('peak', s))


def whisper():
    def run(path):
        boundary = 'peakbakeoff'
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.wav"\r\nContent-Type: audio/wav\r\n\r\n').encode()
        body += path.read_bytes()
        body += f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n--{boundary}--\r\n'.encode()
        req = urllib.request.Request(f'{WHISPER_URL}/inference', body, {'Content-Type': f'multipart/form-data; boundary={boundary}'})
        with urllib.request.urlopen(req) as r:
            return json.load(r)['text']
    return run


def moonshine():
    from moonshine_voice import ModelArch, get_model_for_language, load_wav_file
    from moonshine_voice.transcriber import Transcriber
    path, arch = get_model_for_language('en', ModelArch.MEDIUM_STREAMING)  # downloads on first run
    t = Transcriber(path, arch)

    def run(clip):
        samples, rate = load_wav_file(clip)
        return ' '.join(l.text for l in t.transcribe_without_streaming(samples, rate).lines)
    return run


def parakeet():
    from parakeet_mlx import from_pretrained
    m = from_pretrained('mlx-community/parakeet-tdt-0.6b-v3')
    return lambda path: m.transcribe(str(path)).text


ENGINES = {'whisper': whisper, 'moonshine': moonshine, 'parakeet': parakeet}


def main(names):
    if not CLIPS:
        sys.exit('no clips in bakeoff/clips; see README.md')
    if len(CLIPS) != len(PHRASES):
        print(f'warning: {len(CLIPS)} clips but {len(PHRASES)} phrases; scoring the first {min(len(CLIPS), len(PHRASES))}')
    pairs = list(zip(CLIPS, PHRASES))
    results = {}
    for name in names:
        t0 = time.time()
        run = ENGINES[name]()
        load = time.time() - t0
        run(pairs[0][0])  # warm up
        hyps, times = [], []
        for clip, _ in pairs:
            t0 = time.time()
            hyps.append(run(clip))
            times.append(time.time() - t0)
        refs = [normalize(r) for _, r in pairs]
        hyp_n = [normalize(h) for h in hyps]
        wer = jiwer.wer(refs, hyp_n)
        exact = sum(r == h for r, h in zip(refs, hyp_n))
        results[name] = (wer, exact, sum(times) / len(times), max(times), load)
        print(f'\n== {name}: WER {wer:.1%}, {exact}/{len(pairs)} exact, mean {sum(times)/len(times):.2f}s, max {max(times):.2f}s, load {load:.1f}s')
        for (clip, ref), hyp in zip(pairs, hyps):
            mark = '  ' if normalize(ref) == normalize(hyp) else '!!'
            print(f'{mark} {ref!r:45} -> {hyp.strip()!r}')
    print('\n| Engine | WER | Exact | Mean s | Max s | Load s |\n| --- | --- | --- | --- | --- | --- |')
    for name, (wer, exact, mean, mx, load) in results.items():
        print(f'| {name} | {wer:.1%} | {exact}/{len(pairs)} | {mean:.2f} | {mx:.2f} | {load:.1f} |')


if __name__ == '__main__':
    main(sys.argv[1:] or list(ENGINES))
