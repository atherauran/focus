"""Analyze offline renders: loudness, peaks, dynamics over time, spectral balance.
Usage: python3 scripts/analyze.py renders/*.wav
"""
import json
import re
import subprocess
import sys
import wave

import numpy as np


def ebur128(path):
    r = subprocess.run(['ffmpeg', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True)
    txt = r.stderr
    summary = txt[txt.rfind('Summary:'):]
    I = float(re.search(r'I:\s+(-?[\d.]+) LUFS', summary).group(1))
    lra = float(re.search(r'LRA:\s+(-?[\d.]+) LU', summary).group(1))
    m = re.search(r'Peak:\s+(-?[\d.]+) dBFS', summary)
    tp = float(m.group(1)) if m else float('nan')
    # short-term loudness per 3 s window, from the per-frame log lines
    st = [float(m) for m in re.findall(r'S:\s*(-?[\d.]+)', txt)]
    return I, lra, tp, st


def load(path):
    with wave.open(path) as w:
        n, ch, sr = w.getnframes(), w.getnchannels(), w.getframerate()
        x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768
    return x.reshape(-1, ch), sr


def bands(x, sr):
    mono = x.mean(axis=1)
    edges = [20, 120, 500, 2000, 6000, 20000]
    seg = 1 << 15
    acc = np.zeros(len(edges) - 1)
    for i in range(0, len(mono) - seg, seg):
        spec = np.abs(np.fft.rfft(mono[i:i + seg] * np.hanning(seg))) ** 2
        f = np.fft.rfftfreq(seg, 1 / sr)
        for b in range(len(edges) - 1):
            acc[b] += spec[(f >= edges[b]) & (f < edges[b + 1])].sum()
    acc = 10 * np.log10(acc / acc.sum() + 1e-12)
    return {f'{edges[b]}-{edges[b+1]}': round(float(acc[b]), 1) for b in range(len(acc))}


for path in sys.argv[1:]:
    x, sr = load(path)
    I, lra, tp, st = ebur128(path)
    st_valid = [s for s in st if s > -70]
    clipped = int((np.abs(x) > 0.999).sum())
    width = float(np.std(x[:, 0] - x[:, 1]) / (np.std(x[:, 0] + x[:, 1]) + 1e-9))
    silent = sum(1 for s in st if s < -50) / max(1, len(st))
    print(f'{path}: {len(x)/sr:.0f}s  I={I} LUFS  LRA={lra}  truePeak={tp} dBFS  clipped={clipped}  side/mid={width:.2f}  silent={silent:.0%}')
    if st_valid:
        print(f'   short-term loudness: min {min(st_valid):.1f}  median {np.median(st_valid):.1f}  max {max(st_valid):.1f}')
    print('   spectrum share (dB):', bands(x, sr))
    try:
        meta = json.load(open(path[:-4] + '.json'))
        arrs = []
        for b in meta['bars']:
            if not arrs or arrs[-1][0] != b['arrangement']:
                arrs.append((b['arrangement'], b['style'], b['tempo']))
        print('   pieces:', ', '.join(f'{a}({s}, {t:.0f}bpm)' for a, s, t in arrs))
    except FileNotFoundError:
        pass
