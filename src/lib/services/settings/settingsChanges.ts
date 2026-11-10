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
        const level = (v: unknown) => (v === "owner" ? "admin" : v === "staff" || v === "admin" ? "front desk" : null);
        const from = level(b.access), to = level(a.access);
        if (!to) return [`${a.account}: staff access removed`];
        return [from ? `${a.account}: ${from} → ${to}` : `${a.account}: given ${to} access`];
    }
    if (c.area === "policy") {
        const lines: string[] = [];
        if (b.cancel_cutoff_hours !== a.cancel_cutoff_hours) lines.push(`Online cancellation closes: ${b.cancel_cutoff_hours} → ${a.cancel_cutoff_hours} hours before start`);
        if (b.no_show_grace_minutes !== a.no_show_grace_minutes) lines.push(`No-show grace period: ${b.no_show_grace_minutes} → ${a.no_show_grace_minutes} minutes`);
        return lines;
    }
    return Object.keys({ ...b, ...a })
        .filter((k) => (b[k] ?? null) !== (a[k] ?? null))
        .map((k) => `${k.replace(/_/g, " ")}: ${shown(b[k])} → ${shown(a[k])}`);
}
