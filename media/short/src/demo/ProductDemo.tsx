import React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import timeline from "./timeline.json";

const C = {
  bg: "#0D1B2F",
  panel: "#142236",
  line: "rgba(255,255,255,0.09)",
  accent: "#3E74BB",
  light: "#ACC6E9",
  text: "#F4F7FB",
  muted: "#8FA3BF",
  green: "#34D399",
};
const FONT = `-apple-system, "SF Pro Display", "Helvetica Neue", Inter, Arial, sans-serif`;
const MONO = `"SF Mono", Menlo, Monaco, monospace`;
const ease = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type Clip = { type: "clip"; src: string; from: number; to: number; rate: number; dur?: number; caption?: string; vo?: string };
type Card = { type: "card"; kind: "title" | "chapter" | "verify" | "whyarc" | "outro"; dur: number; num?: string; title?: string; vo?: string };
type Item = Clip | Card;

export const FPS = timeline.fps;
const items = timeline.items as Item[];
export const itemFrames = (it: Item) => Math.round((it.dur ?? (it.type === "clip" ? (it.to - it.from) / it.rate : 0)) * FPS);
const AUDIO = (timeline as { audio?: string }).audio;
export const DEMO_DURATION = items.reduce((s, it) => s + itemFrames(it), 0);

// ── shared visuals ──
const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 80;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(1100px 800px at ${960 + drift}px 300px, rgba(62,116,187,0.32), transparent 70%),
                       radial-gradient(900px 700px at ${300 - drift}px 1000px, rgba(172,198,233,0.10), transparent 70%)`,
        }}
      />
    </AbsoluteFill>
  );
};

const Logo: React.FC<{ size?: number }> = ({ size = 56 }) => (
  <div style={{ display: "flex", alignItems: "center", gap: size * 0.35 }}>
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: `linear-gradient(135deg, ${C.accent}, #2A4F86)`,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        gap: size * 0.08,
        padding: size * 0.2,
        boxSizing: "border-box",
      }}
    >
      {[0.45, 0.75, 1].map((h, i) => (
        <div key={i} style={{ width: size * 0.13, height: `${h * 100}%`, background: "white", borderRadius: 3 }} />
      ))}
    </div>
    <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: size * 0.72, color: C.text, letterSpacing: -1 }}>ClipPool</span>
  </div>
);

const fadeUp = (frame: number, start: number, dur = 16) => ({
  opacity: interpolate(frame, [start, start + dur], [0, 1], clamp),
  transform: `translateY(${interpolate(frame, [start, start + dur], [28, 0], { ...clamp, easing: ease })}px)`,
});

// ── screen recording inside a browser window ──
const WIN_W = 1568;
const WIN_H = 980;
const BAR = 36;
const Window: React.FC<{ clip: Clip; durationInFrames: number }> = ({ clip, durationInFrames }) => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, durationInFrames], [1, 1.025], clamp);
  const capIn = interpolate(frame, [4, 14], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          width: WIN_W,
          height: WIN_H + BAR,
          borderRadius: 18,
          overflow: "hidden",
          border: `1px solid ${C.line}`,
          boxShadow: "0 40px 120px rgba(0,0,0,0.55)",
          background: C.panel,
          position: "relative",
        }}
      >
        <div style={{ height: BAR, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", background: "#0F1A2B", borderBottom: `1px solid ${C.line}` }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
            <div key={c} style={{ width: 12, height: 12, borderRadius: 99, background: c }} />
          ))}
          <div style={{ marginLeft: 18, flex: 1, maxWidth: 560, height: 22, borderRadius: 8, background: "rgba(255,255,255,0.06)", color: C.muted, fontFamily: FONT, fontSize: 13, display: "flex", alignItems: "center", paddingLeft: 12 }}>
            🔒 clippool.vercel.app
          </div>
        </div>
        <div style={{ width: WIN_W, height: WIN_H, overflow: "hidden" }}>
          <div style={{ width: WIN_W, height: WIN_H, transform: `scale(${zoom})`, transformOrigin: "50% 40%" }}>
            <OffthreadVideo src={staticFile(`demo/${clip.src}.mp4`)} trimBefore={Math.round(clip.from * FPS)} playbackRate={clip.rate} muted style={{ width: WIN_W, height: WIN_H, objectFit: "cover" }} />
          </div>
        </div>
        {clip.caption && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 34, display: "flex", justifyContent: "center", opacity: capIn, transform: `translateY(${(1 - capIn) * 12}px)` }}>
            <div style={{ fontFamily: FONT, fontSize: 30, fontWeight: 650, color: C.text, padding: "14px 28px", borderRadius: 16, background: "rgba(10,20,36,0.88)", border: `1px solid ${C.line}`, boxShadow: "0 12px 40px rgba(0,0,0,0.45)" }}>
              {clip.caption}
            </div>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

// ── cards ──
const CardShell: React.FC<{ children: React.ReactNode; dur: number }> = ({ children, dur }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 8, dur - 8, dur], [0, 1, 1, 0], clamp);
  return <AbsoluteFill style={{ opacity: o, alignItems: "center", justifyContent: "center", fontFamily: FONT, color: C.text }}>{children}</AbsoluteFill>;
};

const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      <div style={fadeUp(frame, 0)}>
        <Logo size={84} />
      </div>
      <div style={{ ...fadeUp(frame, 8), marginTop: 44, fontSize: 92, fontWeight: 800, letterSpacing: -3, textAlign: "center", lineHeight: 1.05 }}>
        Get paid for every view.
        <br />
        <span style={{ color: C.light }}>Fairly.</span>
      </div>
      <div style={{ ...fadeUp(frame, 18), marginTop: 30, fontSize: 32, color: C.muted }}>Pro-rata creator campaigns · paid in USDC on Arc</div>
    </>
  );
};

const ChapterCard: React.FC<{ num: string; title: string }> = ({ num, title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14 } });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 36, transform: `scale(${0.92 + s * 0.08})`, opacity: s }}>
      <div style={{ width: 120, height: 120, borderRadius: 32, background: `linear-gradient(135deg, ${C.accent}, #2A4F86)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, fontWeight: 800 }}>{num}</div>
      <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: -2 }}>{title}</div>
    </div>
  );
};

const VERIFY_LINES: [string, string][] = [
  ["$ ", "pnpm --filter @clippool/allocation verify snapshot.json --rpc https://rpc.testnet.arc.io --address 0x5051…6030"],
  ["", "campaign:        2"],
  ["", "allocations:     1"],
  ["", "totalAllocated:  2000000"],
  ["", "recomputed root: 0x7d0383e7d3dbab6b710ee68d52188f4a5bb275842e7dd29a563b90c18ff8d642"],
  ["", "onchain root:    0x7d0383e7d3dbab6b710ee68d52188f4a5bb275842e7dd29a563b90c18ff8d642"],
  ["", "onchain hash:    0x3df35a0d764e4267fe54b64a5cdbde0db36f639473eebb12f68baaf7553cc500"],
  ["PASS", " — snapshot recomputes to its root, which matches the onchain root"],
];
const VerifyCard: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{ width: 1500 }}>
      <div style={{ ...fadeUp(frame, 0), fontSize: 46, fontWeight: 750, marginBottom: 26, letterSpacing: -1 }}>
        Anyone can verify the split <span style={{ color: C.light }}>against the chain</span>
      </div>
      <div style={{ ...fadeUp(frame, 6), background: "#070F1C", borderRadius: 18, border: `1px solid ${C.line}`, padding: "28px 34px", boxShadow: "0 40px 120px rgba(0,0,0,0.5)" }}>
        {VERIFY_LINES.map(([pre, text], i) => {
          const o = interpolate(frame, [14 + i * 9, 20 + i * 9], [0, 1], clamp);
          const isPass = pre === "PASS";
          return (
            <div key={i} style={{ opacity: o, fontFamily: MONO, fontSize: 24, lineHeight: 1.7, color: i === 0 ? C.light : C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {isPass ? (
                <>
                  <span style={{ color: C.bg, background: C.green, padding: "2px 10px", borderRadius: 6, fontWeight: 800 }}>PASS</span>
                  <span style={{ color: C.green }}>{text}</span>
                </>
              ) : (
                <>
                  <span style={{ color: C.green }}>{pre}</span>
                  {text}
                </>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ ...fadeUp(frame, 90), marginTop: 22, fontSize: 26, color: C.muted }}>Real output · campaign #2 on Arc testnet · open-source allocation script</div>
    </div>
  );
};

const WHY = [
  ["USDC as gas · ~$0.001 fees", "Paying hundreds of creators a few cents each is economical"],
  ["Sub-second finality", "Payouts are final the moment they land"],
  ["Native USDC & EURC (EIP-2612)", "One-transaction funding, EUR campaigns"],
  ["Circle user-controlled wallets", "Creators get an Arc wallet with Google sign-in"],
];
const WhyArcCard: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{ width: 1400 }}>
      <div style={{ ...fadeUp(frame, 0), fontSize: 64, fontWeight: 800, letterSpacing: -2, marginBottom: 40 }}>
        Why <span style={{ color: C.light }}>Arc</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {WHY.map(([t, d], i) => (
          <div key={t} style={{ ...fadeUp(frame, 8 + i * 7), background: "rgba(20,34,54,0.85)", border: `1px solid ${C.line}`, borderRadius: 22, padding: "30px 34px" }}>
            <div style={{ fontSize: 34, fontWeight: 700 }}>{t}</div>
            <div style={{ fontSize: 24, color: C.muted, marginTop: 10 }}>{d}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const OutroCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 13 } });
  return (
    <>
      <div style={{ transform: `scale(${0.85 + s * 0.15})`, opacity: s }}>
        <Logo size={110} />
      </div>
      <div style={{ ...fadeUp(frame, 10), marginTop: 40, fontSize: 58, fontWeight: 750, letterSpacing: -1.5, textAlign: "center" }}>
        Fair splits. <span style={{ color: C.light }}>Instant USDC.</span>
      </div>
      <div style={{ ...fadeUp(frame, 20), marginTop: 34, display: "flex", gap: 22, fontSize: 28, color: C.muted }}>
        <span style={{ padding: "12px 24px", borderRadius: 99, border: `1px solid ${C.line}` }}>clippool.vercel.app</span>
        <span style={{ padding: "12px 24px", borderRadius: 99, border: `1px solid ${C.line}` }}>github.com/lazydevpro/clippool</span>
        <span style={{ padding: "12px 24px", borderRadius: 99, border: `1px solid ${C.line}` }}>Built on Arc</span>
      </div>
    </>
  );
};

const renderCard = (it: Card) => {
  switch (it.kind) {
    case "title":
      return <TitleCard />;
    case "chapter":
      return <ChapterCard num={it.num ?? ""} title={it.title ?? ""} />;
    case "verify":
      return <VerifyCard />;
    case "whyarc":
      return <WhyArcCard />;
    case "outro":
      return <OutroCard />;
  }
};

export const ProductDemo: React.FC = () => {
  const frame = useCurrentFrame();
  let at = 0;
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <Background />
      {AUDIO && <Audio src={staticFile(AUDIO)} />}
      {items.map((it, i) => {
        const dur = itemFrames(it);
        const from = at;
        at += dur;
        return (
          <Sequence key={i} from={from} durationInFrames={dur}>
            {it.type === "clip" ? <Window clip={it} durationInFrames={dur} /> : <CardShell dur={dur}>{renderCard(it)}</CardShell>}
          </Sequence>
        );
      })}
      <div style={{ position: "absolute", left: 0, bottom: 0, height: 4, width: `${(frame / DEMO_DURATION) * 100}%`, background: C.accent, opacity: 0.8 }} />
    </AbsoluteFill>
  );
};
