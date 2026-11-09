import { ImageResponse } from "next/og";
import { VENUE_CITY, VENUE_NAME } from "@/lib/brand";

// Link preview for shared URLs (Facebook, Messenger, Viber). Colours are the customer theme's navy and lime.
export const alt = `${VENUE_NAME} – book a pickleball court`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#0d131f", color: "#f5f7fa" }}>
        <div style={{ width: 120, height: 12, background: "#c6f432", borderRadius: 6, marginBottom: 40 }} />
        <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.05 }}>{VENUE_NAME}</div>
        <div style={{ fontSize: 40, marginTop: 24, color: "#c6f432" }}>Book a pickleball court online</div>
        <div style={{ fontSize: 32, marginTop: 12, opacity: 0.7 }}>{VENUE_CITY}</div>
      </div>
    ),
    size,
  );
}
