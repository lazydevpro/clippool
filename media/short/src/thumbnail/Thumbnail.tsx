import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";

const C = {
  bg: "#0B1729",
  accent: "#3E74BB",
  light: "#ACC6E9",
  text: "#FFFFFF",
  muted: "#9DB2CE",
  green: "#34D399",
  amber: "#F5B544",
  line: "rgba(255,255,255,0.12)",
};
const FONT = `-apple-system, "SF Pro Display", "Helvetica Neue", Inter, Arial, sans-serif`;

const Logo: React.FC<{ size: number }> = ({ size }) => (
  <div style={{ display: "flex", alignItems: "center", gap: size * 0.32 }}>
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
    <span style={{ fontFamily: FONT, fontWeight: 800, fontSize: size * 0.7, color: C.text, letterSpacing: -1 }}>ClipPool</span>
  </div>
);

const rows = [
  { name: "@priyashorts", views: "412K views", amt: "+1,000.00", w: 100, cap: true },
  { name: "@onchainoli", views: "269K views", amt: "+920.40", w: 92 },
  { name: "@latamledger", views: "197K views", amt: "+674.95", w: 67 },
];

export const Thumbnail: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg, fontFamily: FONT, overflow: "hidden" }}>
    {/* glow + app screenshot backdrop */}
    <AbsoluteFill
      style={{
        background: `radial-gradient(700px 520px at 1000px 260px, rgba(62,116,187,0.55), transparent 70%),
                     radial-gradient(600px 500px at 120px 720px, rgba(52,211,153,0.16), transparent 70%)`,
      }}
    />
    <Img
      src={staticFile("demo/thumb-bg.png")}
      style={{
        position: "absolute",
        right: -150,
        top: 70,
        width: 900,
        borderRadius: 18,
        opacity: 0.22,
        transform: "perspective(1400px) rotateY(-14deg) rotateX(4deg)",
        boxShadow: "0 30px 90px rgba(0,0,0,0.6)",
      }}
    />

    {/* left: headline */}
    <div style={{ position: "absolute", left: 64, top: 56 }}>
      <Logo size={58} />
    </div>
    <div style={{ position: "absolute", left: 60, top: 168, width: 700 }}>
      <div style={{ fontSize: 112, fontWeight: 900, lineHeight: 0.98, letterSpacing: -5, color: C.text, textShadow: "0 6px 30px rgba(0,0,0,0.5)" }}>
        GET PAID
        <br />
        <span style={{ color: C.light }}>PER VIEW</span>
      </div>
      <div style={{ marginTop: 30, display: "inline-flex", alignItems: "center", gap: 14, padding: "14px 26px", borderRadius: 999, background: C.green, color: "#062417", fontSize: 38, fontWeight: 850, letterSpacing: -0.5 }}>
        ⚡ Instant USDC on Arc
      </div>
    </div>

    {/* right: payout card */}
    <div
      style={{
        position: "absolute",
        right: 56,
        top: 150,
        width: 460,
        padding: "30px 32px",
        borderRadius: 30,
        background: "rgba(16,30,52,0.92)",
        border: `2px solid ${C.line}`,
        boxShadow: "0 40px 100px rgba(0,0,0,0.6)",
        transform: "rotate(2.5deg)",
        color: C.text,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 24, color: C.muted, fontWeight: 650 }}>
        <span>Pool split by views</span>
        <span style={{ color: C.text, fontSize: 30, fontWeight: 800 }}>5,000 USDC</span>
      </div>
      {rows.map((r) => (
        <div key={r.name} style={{ marginTop: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, fontWeight: 750 }}>
            <span>
              {r.name}
              {r.cap && <span style={{ marginLeft: 10, fontSize: 18, padding: "3px 10px", borderRadius: 99, background: "rgba(245,181,68,0.2)", color: C.amber, verticalAlign: "middle" }}>cap</span>}
            </span>
            <span style={{ color: C.green }}>{r.amt}</span>
          </div>
          <div style={{ height: 14, borderRadius: 99, background: "rgba(255,255,255,0.08)", marginTop: 10 }}>
            <div style={{ width: `${r.w}%`, height: "100%", borderRadius: 99, background: `linear-gradient(90deg, ${C.accent}, ${C.light})` }} />
          </div>
          <div style={{ fontSize: 18, color: C.muted, marginTop: 6 }}>{r.views}</div>
        </div>
      ))}
      <div style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 10, fontSize: 22, fontWeight: 700, color: C.green }}>
        ✓ Paid in one transaction · final &lt; 1s
      </div>
    </div>

    {/* bottom strip */}
    <div style={{ position: "absolute", left: 64, bottom: 44, display: "flex", gap: 14 }}>
      {["Brands lock a pool", "Creators post Shorts", "Fair split"].map((t) => (
        <span key={t} style={{ fontSize: 24, fontWeight: 700, color: C.text, padding: "10px 20px", borderRadius: 14, background: "rgba(255,255,255,0.08)", border: `1px solid ${C.line}` }}>
          {t}
        </span>
      ))}
    </div>
  </AbsoluteFill>
);
