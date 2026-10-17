"""Per-piece loudness and spectral balance of a render, using its bar log."""
import json, sys, wave
import numpy as np
path = sys.argv[1]
meta = json.load(open(path[:-4] + '.json'))
with wave.open(path) as w:
    sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32).reshape(-1, 2) / 32768
t = 0.0; segs = []
for b in meta['bars']:
    d = b['beats'] * 60 / b['tempo']
    if not segs or segs[-1][0] != (b['piece'], b['arrangement']): segs.append([(b['piece'], b['arrangement']), t, t + d])
    else: segs[-1][2] = t + d
    t += d
edges = [20, 120, 500, 2000, 6000, 20000]
for (p, a), t0, t1 in segs:
    seg = x[int(t0 * sr):int(min(t1, len(x) / sr) * sr)].mean(axis=1)
    if len(seg) < sr: continue
    rms = 20 * np.log10(np.sqrt((seg ** 2).mean()) + 1e-9)
    n = 1 << 15; acc = np.zeros(5)
    for i in range(0, len(seg) - n, n):
        s = np.abs(np.fft.rfft(seg[i:i + n] * np.hanning(n))) ** 2; f = np.fft.rfftfreq(n, 1 / sr)
        for k in range(5): acc[k] += s[(f >= edges[k]) & (f < edges[k + 1])].sum()
    sh = 10 * np.log10(acc / acc.sum() + 1e-12)
    print(f'{p} {a:14s} {t0:6.0f}-{t1:4.0f}s rms {rms:6.1f} dB  bands ' + ' '.join(f'{v:6.1f}' for v in sh))
