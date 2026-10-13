"""Generate docs/submission/demo-voiceover.md from media/short/src/demo/timeline.json (run from repo root)."""
import json

t = json.load(open("media/short/src/demo/timeline.json"))
fps = t["fps"]
at = 0
rows = []
for it in t["items"]:
    d = round(((it["to"] - it["from"]) / it["rate"]) * fps) if it["type"] == "clip" else round(it["dur"] * fps)
    label = it.get("caption") or (f"{it.get('num', '')} · {it.get('title', '')}" if it.get("kind") == "chapter" else it.get("kind"))
    rows.append([at / fps, d / fps, label, it.get("vo", "")])
    at += d
total = at / fps
lines = []
for s, d, label, vo in rows:
    if vo or not lines:
        lines.append([s, d, label, vo])
    else:
        lines[-1][1] += d
        lines[-1][2] += " + " + label
mmss = lambda x: f"{int(x // 60)}:{x % 60:04.1f}"
out = [
    "# Demo voiceover script",
    "",
    f"Video: `media/short/out/clippool-demo-draft.mp4` · {mmss(total)} · 1920×1080 · no audio yet.",
    "Start each line at its timecode. Budget ≈ 2.6 words/second; if a line runs long, say which and the shot gets stretched.",
    "Record one take (or one file per line) as WAV/M4A in a quiet room; send the file(s) to sync + light music + re-render.",
    "",
    "| Start | Window | On screen | Say | Words (max) |",
    "|---|---|---|---|---|",
]
for s, d, label, vo in lines:
    w, cap = len(vo.split()), int(d * 2.6)
    out.append(f"| {mmss(s)} | {d:.1f}s | {label} | {vo} | {w}/{cap}{' ⚠' if w > cap else ''} |")
open("docs/submission/demo-voiceover.md", "w").write("\n".join(out) + "\n")
print(f"total {mmss(total)}; over budget: {sum(1 for s, d, l, v in lines if len(v.split()) > int(d * 2.6))}")
