"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase";
import { formatTime12h } from "@/lib/utils/formatTime";
import { AddWalkupModal } from "./add-walkup-modal";
import { type OpenPlayAdminSession, hasEnded } from "./open-play-container";

interface SpotRow {
  id: string;
  status: string;
  hold_expires_at: string | null;
  open_play_spots: number;
  customer_name: string | null;
  total_amount: number | null;
  profiles: { full_name: string | null; phone: string | null } | null;
  customers: { phone: string | null } | null;
  payments: { status: string; payment_method: string | null; amount: number | null }[];
}

const METHODS: Record<string, string> = { cash: "Cash", gcash: "GCash" };

// The payment is the source of truth for money; the booking status says whether the spots are still held
const statusLabel = (r: SpotRow) => {
  const p = r.payments[0];
  if (r.status === "cancelled") return p?.status === "refunded" ? "Cancelled · refunded" : p?.status === "paid" || p?.status === "succeeded" ? "Cancelled · refund owed" : "Cancelled";
  if (r.status === "pending") return r.hold_expires_at === "infinity" ? "Awaiting verification" : "Unpaid (holding)";
  return p?.status === "paid" || p?.status === "succeeded" ? "Paid" : "Unpaid";
};

interface Props {
  session: OpenPlayAdminSession;
  onCancel: (s: OpenPlayAdminSession) => void;
  onChanged: () => void;
}

export function PlayersPanel({ session, onCancel, onChanged }: Props) {
  const [rows, setRows] = useState<SpotRow[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("bookings")
      .select("id, status, hold_expires_at, open_play_spots, customer_name, total_amount, profiles:user_id(full_name, phone), customers(phone), payments(status, payment_method, amount)")
      .eq("open_play_session_id", session.id)
      .is("court_id", null)
      .order("created_at", { ascending: true });
    setRows((data ?? []) as unknown as SpotRow[]);
  }, [session.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets state after its await
    load();
  }, [load]);

  const awaiting = rows?.some((r) => r.status === "pending" && r.hold_expires_at === "infinity") ?? false;
  const collected = (rows ?? []).flatMap((r) => r.payments).filter((p) => p.status === "paid" || p.status === "succeeded").reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const date = new Date(`${session.session_date}T12:00:00+08:00`).toLocaleDateString("en-US", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" });

  return (
    <Card className="border border-border shadow-2xs">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base font-bold">
            Players for {date} · {formatTime12h(session.start_time)} – {formatTime12h(session.end_time)}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {session.booked} of {session.capacity} spots booked · ₱{collected.toLocaleString()} collected
          </p>
        </div>
        {session.status === "open" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2 font-bold" onClick={() => setAdding(true)}>
              <UserPlus className="h-4 w-4" />
              Add player
            </Button>
            {!hasEnded(session) && (
              <Button variant="destructive" className="font-bold" disabled={awaiting} onClick={() => onCancel(session)}>
                Cancel session &amp; refund everyone
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {awaiting && !hasEnded(session) && (
          <p role="alert" className="mb-3 text-xs text-amber-800 dark:text-amber-300">
            Approve or reject the GCash payments waiting for verification first (Bookings, filter &quot;Awaiting verification&quot;), then reopen this list to cancel the session.
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Paid via</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows === null ? (
              <TableRow><TableCell colSpan={4}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">Nobody has booked this session yet.</TableCell></TableRow>
            ) : (
              rows.map((r) => {
                const name = r.profiles?.full_name || r.customer_name || "Guest Player";
                const method = r.payments[0]?.payment_method;
                return (
                  <TableRow key={r.id} className={r.status === "cancelled" ? "opacity-60" : ""}>
                    <TableCell className="font-semibold">{r.open_play_spots > 1 ? `${name} +${r.open_play_spots - 1}` : name}</TableCell>
                    <TableCell>{r.profiles?.phone || r.customers?.phone || "—"}</TableCell>
                    <TableCell>{method ? (METHODS[method] ?? "Card") : "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs font-semibold">{statusLabel(r)}</Badge></TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
      {adding && (
        <AddWalkupModal
          session={session}
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); load(); onChanged(); }}
        />
      )}
    </Card>
  );
}
