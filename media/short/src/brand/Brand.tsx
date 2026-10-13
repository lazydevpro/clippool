import React from "react";
import { AbsoluteFill } from "remotion";

const ACCENT = "#3E74BB";
const DEEP = "#2A4F86";
const FONT = `-apple-system, "SF Pro Display", "Helvetica Neue", Inter, Arial, sans-serif`;

const Mark: React.FC<{ size: number; radius?: number }> = ({ size, radius = 0.28 }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * radius,
      background: `linear-gradient(135deg, ${ACCENT}, ${DEEP})`,
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "center",
      gap: size * 0.08,
      padding: size * 0.2,
      boxSizing: "border-box",
      boxShadow: `inset 0 ${size * 0.01}px ${size * 0.02}px rgba(255,255,255,0.25)`,
    }}
  >
    {[0.45, 0.75, 1].map((h, i) => (
      <div key={i} style={{ width: size * 0.13, height: `${h * 100}%`, background: "white", borderRadius: size * 0.03 }} />
    ))}
  </div>
);

/** Square app logo (DoraHacks / avatars): full-bleed mark on transparent bg. */
export const LogoSquare: React.FC = () => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <Mark size={1024} radius={0.22} />
  </AbsoluteFill>
);

/** Horizontal wordmark on transparent background (light text for dark backgrounds). */
export const Wordmark: React.FC<{ dark?: boolean }> = ({ dark }) => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 64 }}>
      <Mark size={300} />
      <span style={{ fontFamily: FONT, fontWeight: 800, fontSize: 240, letterSpacing: -8, color: dark ? "#0D1B2F" : "#FFFFFF" }}>ClipPool</span>
    </div>
  </AbsoluteFill>
);
