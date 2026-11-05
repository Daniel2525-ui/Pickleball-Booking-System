/** One row of public.settings_changes (written by a trigger on booking_settings). */
export interface SettingsChange {
    id: number;
    changed_at: string;
    area: string;
    before: Record<string, string | number | null>;
    after: Record<string, string | number | null>;
    profiles?: { full_name: string | null } | null;
}

const shown = (v: string | number | null | undefined) => (v !== null && v !== undefined && String(v).trim() ? String(v) : "(empty)");

/** What a settings change did, in staff wording. */
export function describeSettingsChange(c: Pick<SettingsChange, "area" | "before" | "after">): string[] {
    const b = c.before ?? {}, a = c.after ?? {};
    if (c.area === "staff") {
        return [a.access === "admin" ? `${a.account}: given staff access` : `${a.account}: staff access removed`];
    }
    if (c.area === "policy") {
        const lines: string[] = [];
        if (b.cancel_cutoff_hours !== a.cancel_cutoff_hours) lines.push(`Online cancellation closes: ${b.cancel_cutoff_hours} → ${a.cancel_cutoff_hours} hours before start`);
        if (b.no_show_grace_minutes !== a.no_show_grace_minutes) lines.push(`No-show grace period: ${b.no_show_grace_minutes} → ${a.no_show_grace_minutes} minutes`);
        return lines;
    }
    if (c.area !== "gcash") {
        return Object.keys({ ...b, ...a })
            .filter((k) => (b[k] ?? null) !== (a[k] ?? null))
            .map((k) => `${k.replace(/_/g, " ")}: ${shown(b[k])} → ${shown(a[k])}`);
    }
    const lines: string[] = [];
    if (!b.number && a.number) lines.push("GCash turned on");
    if (b.number && !a.number) lines.push("GCash turned off");
    if ((b.number ?? null) !== (a.number ?? null) && b.number && a.number) lines.push(`GCash number: ${b.number} → ${a.number}`);
    else if (!b.number && a.number) lines.push(`GCash number: ${a.number}`);
    if ((b.account_name ?? null) !== (a.account_name ?? null) && a.account_name) {
        lines.push(b.account_name ? `Account name: ${b.account_name} → ${a.account_name}` : `Account name: ${a.account_name}`);
    }
    if ((b.qr_url ?? null) !== (a.qr_url ?? null)) lines.push(!b.qr_url ? "QR code added" : !a.qr_url ? "QR code removed" : "QR code replaced");
    return lines;
}
