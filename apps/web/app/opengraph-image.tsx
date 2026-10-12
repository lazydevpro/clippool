import { ImageResponse } from "next/og";

export const alt = "ClipPool: get paid for every view, fairly. Pro-rata creator campaigns on Arc.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BARS = [
  { w: 520, label: "20.0%" },
  { w: 480, label: "18.4%" },
  { w: 352, label: "13.5%" },
  { w: 276, label: "10.6%" },
];

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #0D1B2F 0%, #142236 60%, #1d3a63 100%)",
          color: "#E8EEF7",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "#3E74BB",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              gap: 6,
              paddingBottom: 12,
            }}
          >
            <div style={{ width: 8, height: 14, borderRadius: 3, background: "#ACC6E9" }} />
            <div style={{ width: 8, height: 24, borderRadius: 3, background: "#fff" }} />
            <div style={{ width: 8, height: 32, borderRadius: 3, background: "#ACC6E9" }} />
          </div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>ClipPool</div>
          <div style={{ marginLeft: "auto", fontSize: 24, color: "#ACC6E9" }}>Built on Arc</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>Get paid for every view.</div>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2, color: "#ACC6E9" }}>Fairly.</div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ fontSize: 28, color: "#92A5C0", maxWidth: 560 }}>
            Brands lock a USDC pool. Creators post Shorts. Split by views, paid instantly onchain.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {BARS.map((b) => (
              <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: b.w, height: 14, borderRadius: 7, background: "linear-gradient(90deg, #3E74BB, #ACC6E9)" }} />
                <div style={{ fontSize: 20, color: "#ACC6E9", width: 70 }}>{b.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
