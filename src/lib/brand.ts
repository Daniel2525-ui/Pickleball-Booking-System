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
/** The live site's address, for absolute link-preview URLs; unset locally */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || undefined;
