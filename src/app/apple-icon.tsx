import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// iOS home screen (and Safari, which has no SVG favicon support): same artwork as icon.svg
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const svg = await readFile(join(process.cwd(), "src/app/icon.svg"), "utf8");
  return new ImageResponse(
    (
      // Full-bleed navy: iOS rounds the corners itself and would show black where the SVG's corners are clear
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#060d1a" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img>, next/image can't run here */}
        <img src={`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`} width={180} height={180} alt="" />
      </div>
    ),
    size
  );
}
