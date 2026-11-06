/** Pure helpers for the customer's basket: one line per time range, so a court can appear several times. */
type Line = { court: string; price: number; hasPeak?: boolean; startSlot?: string; time?: string };

/** A line is one court from one start slot; changing its length keeps the same key. */
export const lineKey = (l: Line) => `${l.court}|${l.startSlot ?? l.time ?? ""}`;

export const removeLine = <T extends Line>(lines: T[], key: string): T[] =>
  lines.filter((l) => lineKey(l) !== key);

/**
 * One court's picked ranges as [start, end) slot indexes, sorted, with touching ranges joined into one
 * while the result stays within `maxLen` hours (each range becomes one booking, capped at the max length).
 */
export const mergeSpans = (spans: (readonly [number, number])[], maxLen: number): [number, number][] =>
  [...spans]
    .sort((a, b) => a[0] - b[0])
    .reduce<[number, number][]>((out, [s, e]) => {
      const last = out.at(-1);
      if (last && last[1] === s && e - last[0] <= maxLen) last[1] = e;
      else out.push([s, e]);
      return out;
    }, []);

export const basketTotal = (lines: Line[]) => ({
  total: lines.reduce((sum, l) => sum + l.price, 0),
  hasPeak: lines.some((l) => l.hasPeak),
});

/** Courts in the same unpaid basket as `booking` (a legacy NULL basket is alone). */
export const pendingBasketSize = (
  rows: { basket_id?: string | null; status: string }[],
  booking: { basket_id?: string | null },
) =>
  booking.basket_id
    ? rows.filter((r) => r.basket_id === booking.basket_id && r.status === "pending").length
    : 1;

/** After a failed checkout: keep only lines whose slots are all still free. */
export const splitTakenLines = <T extends Line>(lines: T[], isFree: (line: T) => boolean) => ({
  kept: lines.filter(isFree),
  dropped: lines.filter((l) => !isFree(l)),
});

/** A user's bookings, one group per checkout (basket); a booking without a basket is its own group. */
export const groupByCheckout = <T extends { id: string; basket_id?: string | null }>(rows: T[]): T[][] => {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.basket_id ?? row.id;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()];
};

/** A court that still counts: not cancelled and not a no-show. */
export const isLive = (b: { status: string }) => b.status !== "cancelled" && b.status !== "no_show";

/** What a checkout comes to: its live courts, or every court once all were cancelled (shown struck). */
export const checkoutTotal = (group: { status: string; total_amount?: number | null }[]) => {
  const counted = group.some(isLive) ? group.filter(isLive) : group;
  return counted.reduce((sum, b) => sum + Number(b.total_amount ?? 0), 0);
};

/**
 * Applies a hold's checked status: an expired hold releases every pending court of its basket, but any other result
 * (e.g. confirmed) changes only the court checked, since a sibling may have been lost to a late payment.
 */
export const settleHold = <T extends { id: string; basket_id?: string | null; status: string; cancel_reason?: string | null }>(
  rows: T[],
  checked: T,
  status: string,
  cancelReason: string | null | undefined,
): T[] =>
  rows.map((b) =>
    b.id === checked.id || (status === "cancelled" && checked.basket_id && b.basket_id === checked.basket_id && b.status === "pending")
      ? { ...b, status, cancel_reason: cancelReason }
      : b,
  );
