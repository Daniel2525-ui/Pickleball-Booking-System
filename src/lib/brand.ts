/**
 * The venue's name and city, set per client deployment (NEXT_PUBLIC_VENUE_NAME / NEXT_PUBLIC_VENUE_CITY).
 * The defaults are the first client's, so a deployment without the settings looks as it always has.
 * Literal process.env.NEXT_PUBLIC_* reads, so Next inlines them into browser code too.
 */

/** The setting trimmed, or the fallback when it's missing or blank. */
export const brandName = (raw: string | undefined, fallback: string) => raw?.trim() || fallback;

/** The name split for the two-tone wordmark: the last word is the accent colour. */
export const splitBrandName = (name: string) => {
  const words = name.trim().split(/\s+/);
  const accent = words.pop() ?? "";
  return { lead: words.join(" "), accent };
};

export const VENUE_NAME = brandName(process.env.NEXT_PUBLIC_VENUE_NAME, "Crosshair Dinkers");
export const VENUE_CITY = brandName(process.env.NEXT_PUBLIC_VENUE_CITY, "Butuan City");
/** "AB" from the venue name's first two words, for the logo tile when there is no logo image */
export const brandInitials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

/** A #RRGGBB colour, or the fallback when the setting is missing or not one */
export const brandColor = (raw: string | undefined, fallback = "#0E7C66") =>
  /^#[0-9a-f]{6}$/i.test(raw?.trim() ?? "") ? raw!.trim() : fallback;

/** Text colour that reads on the brand colour: white when it passes 4.5:1, otherwise near-black */
export const onBrandColor = (hex: string) => {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (luminance + 0.05) >= 4.5 ? "#FFFFFF" : "#111816";
};

/** One brand colour per deployment (NEXT_PUBLIC_BRAND_COLOR); buttons, links and highlights use it */
export const BRAND_COLOR = brandColor(process.env.NEXT_PUBLIC_BRAND_COLOR);
/** "night" keeps the dark navy-and-lime customer theme (NEXT_PUBLIC_THEME); anything else is the light theme */
export const THEME: "club" | "night" = process.env.NEXT_PUBLIC_THEME?.trim() === "night" ? "night" : "club";

/** The live site's address, for absolute link-preview URLs; unset locally */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || undefined;
