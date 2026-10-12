import React from "react";
import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const FPS = 30;
export const DURATION = 20 * FPS;

// Arc-inspired palette
const C = {
  bg: "#0D1B2F",
  panel: "#142236",
  line: "rgba(255,255,255,0.08)",
  accent: "#3E74BB",
  light: "#ACC6E9",
  text: "#F4F7FB",
  muted: "#8FA3BF",
  green: "#34D399",
  amber: "#F5B544",
};
const FONT = `-apple-system, "SF Pro Display", "Helvetica Neue", Inter, Arial, sans-serif`;

const ease = Easing.bezier(0.16, 1, 0.3, 1);
const fadeUp = (frame: number, start: number, dur = 18) => ({
  opacity: interpolate(frame, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  transform: `translateY(${interpolate(frame, [start, start + dur], [40, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease })}px)`,
});
const fmt = (n: number, dp = 2) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

// ── shared chrome ──
const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 60) * 60;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(900px 900px at ${540 + drift}px ${520 - drift / 2}px, rgba(62,116,187,0.35), transparent 70%),
                       radial-gradient(700px 700px at ${300 - drift}px 1600px, rgba(172,198,233,0.12), transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${C.line} 1px, transparent 1px), linear-gradient(90deg, ${C.line} 1px, transparent 1px)`,
          backgroundSize: "90px 90px",
          maskImage: "radial-gradient(circle at 50% 40%, black, transparent 75%)",
          opacity: 0.6,
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

const Caption: React.FC<{ children: React.ReactNode; start?: number }> = ({ children, start = 0 }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        bottom: 470,
        left: 80,
        right: 80,
        textAlign: "center",
        fontFamily: FONT,
        fontSize: 62,
        fontWeight: 650,
        lineHeight: 1.15,
        color: C.text,
        letterSpacing: -1,
        ...fadeUp(frame, start),
      }}
    >
      {children}
    </div>
  );
};

const Panel: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      background: "rgba(20,34,54,0.85)",
      border: `1px solid ${C.line}`,
      borderRadius: 40,
      padding: 56,
      boxShadow: "0 40px 120px rgba(0,0,0,0.45)",
      fontFamily: FONT,
      color: C.text,
      ...style,
    }}
  >
    {children}
  </div>
);

// ── scene 1: hook ──
const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const words = ["Get", "paid", "for", "every", "view."];
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 90 }}>
      <div style={{ ...fadeUp(frame, 0, 14), marginBottom: 60, padding: "14px 30px", borderRadius: 999, border: `1px solid ${C.line}`, background: "rgba(62,116,187,0.18)", color: C.light, fontFamily: FONT, fontSize: 34, fontWeight: 600 }}>
        ● USDC payouts on Arc
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 28px", fontFamily: FONT, fontWeight: 800, fontSize: 150, lineHeight: 1.02, letterSpacing: -5 }}>
        {words.map((w, i) => (
          <span key={w} style={{ color: i >= 3 ? C.light : C.text, ...fadeUp(frame, 6 + i * 5, 16) }}>
            {w}
          </span>
        ))}
      </div>
      <div style={{ ...fadeUp(frame, 40), marginTop: 60, fontFamily: FONT, fontSize: 64, fontWeight: 700, color: C.accent }}>Fairly.</div>
    </AbsoluteFill>
  );
};

// ── scene 2: the pool ──
const Pool: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const amount = interpolate(frame, [10, 60], [0, 5000], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const pop = spring({ frame: frame - 4, fps, config: { damping: 14 } });
  const lock = spring({ frame: frame - 62, fps, config: { damping: 10 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 480 }}>
      <Panel style={{ width: 860, transform: `scale(${0.85 + pop * 0.15})`, opacity: pop }}>
        <div style={{ display: "flex", justifyContent: "space-between", color: C.muted, fontSize: 34, fontWeight: 600 }}>
          <span>Campaign pool</span>
          <span style={{ color: C.green, opacity: lock, transform: `scale(${lock})` }}>🔒 Locked onchain</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 36 }}>
          <div style={{ width: 110, height: 110, borderRadius: 999, background: "#2775CA", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 64, fontWeight: 800, color: "white" }}>$</div>
          <div style={{ fontSize: 132, fontWeight: 800, letterSpacing: -4, fontVariantNumeric: "tabular-nums" }}>{fmt(amount, 0)}</div>
        </div>
        <div style={{ marginTop: 16, fontSize: 40, color: C.light, fontWeight: 600 }}>USDC · per-creator cap 20%</div>
      </Panel>
      <Caption start={20}>A brand locks a USDC pool.</Caption>
    </AbsoluteFill>
  );
};

// ── scene 3: views decide the split ──
const creators = [
  { name: "@priyashorts", views: 412_000, share: 0.2, capped: true },
  { name: "@onchainoli", views: 269_000, share: 0.184 },
  { name: "@latamledger", views: 197_000, share: 0.135 },
  { name: "@manilaminutes", views: 155_000, share: 0.106 },
];
const Split: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 360 }}>
      <Panel style={{ width: 880 }}>
        <div style={{ color: C.muted, fontSize: 34, fontWeight: 600, marginBottom: 36 }}>Live split by views</div>
        {creators.map((c, i) => {
          const p = interpolate(frame, [8 + i * 6, 70 + i * 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
          return (
            <div key={c.name} style={{ marginBottom: 40, ...fadeUp(frame, i * 6, 14) }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 40, fontWeight: 650 }}>
                <span>
                  {c.name}
                  {c.capped && p > 0.95 && (
                    <span style={{ marginLeft: 16, fontSize: 26, padding: "4px 14px", borderRadius: 999, background: "rgba(245,181,68,0.18)", color: C.amber }}>20% cap</span>
                  )}
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(5000 * c.share * p)} </span>
              </div>
              <div style={{ height: 18, borderRadius: 999, background: "rgba(255,255,255,0.07)", marginTop: 14, overflow: "hidden" }}>
                <div style={{ width: `${(c.share / 0.2) * 100 * p}%`, height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${C.accent}, ${C.light})` }} />
              </div>
              <div style={{ fontSize: 28, color: C.muted, marginTop: 10, fontVariantNumeric: "tabular-nums" }}>{Math.round(c.views * p).toLocaleString("en-US")} views</div>
            </div>
          );
        })}
      </Panel>
      <Caption start={30}>
        Creators post Shorts.
        <br />
        <span style={{ color: C.light }}>Views decide the split.</span>
      </Caption>
    </AbsoluteFill>
  );
};

// ── scene 4: instant payouts ──
const Payout: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 460 }}>
      <Panel style={{ width: 880 }}>
        <div style={{ display: "flex", justifyContent: "space-between", color: C.muted, fontSize: 34, fontWeight: 600, marginBottom: 30 }}>
          <span>Payouts</span>
          <span style={{ color: C.green, ...fadeUp(frame, 60, 12) }}>⚡ final in 0.48s</span>
        </div>
        {creators.map((c, i) => {
          const t = spring({ frame: frame - (12 + i * 10), fps, config: { damping: 12 } });
          return (
            <div key={c.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 0", borderTop: i ? `1px solid ${C.line}` : "none", fontSize: 40, fontWeight: 650 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 18 }}>
                <span style={{ width: 48, height: 48, borderRadius: 999, background: C.green, color: C.bg, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 30, transform: `scale(${t})` }}>✓</span>
                {c.name}
              </span>
              <span style={{ color: C.green, opacity: t, fontVariantNumeric: "tabular-nums" }}>+{fmt(5000 * c.share)} USDC</span>
            </div>
          );
        })}
      </Panel>
      <Caption start={20}>
        Paid instantly in USDC
        <br />
        <span style={{ color: C.light }}>on Arc. ~$0.001 fees.</span>
      </Caption>
    </AbsoluteFill>
  );
};

// ── scene 5: end card ──
const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 13 } });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 56 }}>
      <div style={{ transform: `scale(${0.8 + s * 0.2})`, opacity: s }}>
        <Logo size={120} />
      </div>
      <div style={{ ...fadeUp(frame, 12), fontFamily: FONT, fontSize: 70, fontWeight: 750, color: C.text, textAlign: "center", letterSpacing: -2, lineHeight: 1.1 }}>
        Fair splits.
        <br />
        <span style={{ color: C.light }}>Instant USDC.</span>
      </div>
      <div style={{ ...fadeUp(frame, 26), fontFamily: FONT, fontSize: 36, color: C.muted, padding: "16px 34px", borderRadius: 999, border: `1px solid ${C.line}` }}>
        Built on Arc · testnet pilot
      </div>
    </AbsoluteFill>
  );
};

// scene timing (frames)
const SCENES: [React.FC, number, number][] = [
  [Hook, 0, 105],
  [Pool, 105, 120],
  [Split, 225, 150],
  [Payout, 375, 120],
  [EndCard, 495, 105],
];

const SceneFade: React.FC<{ children: React.ReactNode; dur: number }> = ({ children, dur }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8, dur - 8, dur], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const ClipPoolShort: React.FC = () => {
  const frame = useCurrentFrame();
  const progress = frame / DURATION;
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <Background />
      <div style={{ position: "absolute", top: 120, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: interpolate(frame, [480, 500], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        <Logo size={64} />
      </div>
      {SCENES.map(([Scene, from, dur], i) => (
        <Sequence key={i} from={from} durationInFrames={dur}>
          <SceneFade dur={i === SCENES.length - 1 ? dur + 30 : dur}>
            <Scene />
          </SceneFade>
        </Sequence>
      ))}
      <div style={{ position: "absolute", bottom: 140, left: 120, right: 120, height: 8, borderRadius: 999, background: "rgba(255,255,255,0.08)" }}>
        <div style={{ width: `${progress * 100}%`, height: "100%", borderRadius: 999, background: C.accent }} />
      </div>
    </AbsoluteFill>
  );
};
