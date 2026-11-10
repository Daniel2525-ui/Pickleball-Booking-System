"use client";

import { useCallback, useEffect, useState } from "react";
import { History, MoreHorizontal, UserPlus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog, ConfirmRequest } from "@/components/ui/confirm-dialog";
import { CancelPaidModal } from "@/components/admin/bookings/cancelPaidModal";
import { BookingHistoryModal } from "@/components/admin/bookings/bookingHistoryModal";
import { updateBookingStatus } from "@/lib/services/bookings/updateBookingStatus.service";
import { bookingRef } from "@/lib/services/openPlay/bookingTitle";
import { Booking } from "@/lib/services/bookings/bookingsTypes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase";
import { formatTime12h } from "@/lib/utils/formatTime";
import { formatManilaDate } from "@/lib/utils/bookingTime";
import { AddWalkupModal } from "./add-walkup-modal";
import { type OpenPlayAdminSession, hasEnded } from "./open-play-container";

interface SpotRow {
  id: string;
  user_id: string | null;
  status: string;
  cancel_reason: string | null;
  hold_expires_at: string | null;
  open_play_spots: number;
  customer_name: string | null;
  total_amount: number | null;
  profiles: { full_name: string | null; phone: string | null; skill_level: string | null } | null;
  customers: { phone: string | null } | null;
  payments: { status: string; payment_method: string | null; amount: number | null }[];
}

const METHODS: Record<string, string> = { cash: "Cash", gcash: "QR Ph" };

// The payment is the source of truth for money; the booking status says whether the spots are still held
const statusLabel = (r: SpotRow) => {
  const p = r.payments[0];
  if (r.status === "cancelled" && r.cancel_reason === "payment_kept") return "Cancelled · payment kept";
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
  const [cancelPaid, setCancelPaid] = useState<Booking | null>(null);
  const [historyOf, setHistoryOf] = useState<Booking | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("bookings")
      .select("id, user_id, status, cancel_reason, hold_expires_at, open_play_spots, customer_name, total_amount, profiles:user_id(full_name, phone, skill_level), customers(phone), payments(status, payment_method, amount)")
      .eq("open_play_session_id", session.id)
      .is("court_id", null)
      .order("created_at", { ascending: true });
    setRows((data ?? []) as unknown as SpotRow[]);
  }, [session.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets state after its await
    load();
  }, [load]);

  // The modals only read id, name and the player's account from the booking
  const asBooking = (r: SpotRow) => ({ id: r.id, user_id: r.user_id, customer_name: r.profiles?.full_name || r.customer_name || "Guest Player" }) as Booking;

  // One player only; the same /api/admin/bookings/status rules as the Bookings page (refund or keep a paid one)
  const cancelPlayer = async (booking: Booking, keep?: { note: string }) => {
    const { error } = await updateBookingStatus(booking.id, "cancelled", keep);
    if (error) {
      toast.error(error);
      return false;
    }
    toast.success(keep ? "Player cancelled. The payment was kept." : "Player cancelled. Their spots are free again.");
    load();
    onChanged();
    return true;
  };

  const askCancelPlayer = (r: SpotRow) => {
    const paid = r.payments.some((p) => p.status === "paid" || p.status === "succeeded");
    if (paid) return setCancelPaid(asBooking(r));
    setConfirmRequest({
      title: "Cancel this player?",
      description: `${asBooking(r).customer_name}'s unpaid spots will be released.`,
      confirmLabel: "Cancel Player",
      onConfirm: () => cancelPlayer(asBooking(r)),
    });
  };

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
            {/* Like walk-ins: today or later only, so nothing is backdated */}
            {session.session_date >= formatManilaDate() && (
              <Button variant="outline" className="gap-2 font-bold" onClick={() => setAdding(true)}>
                <UserPlus className="h-4 w-4" />
                Add player
              </Button>
            )}
            {!hasEnded(session) && (
              <Button variant="destructive" className="font-bold" disabled={awaiting} onClick={() => onCancel(session)}>
                Cancel session &amp; refund everyone
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      {/* Edge-to-edge table: its cell padding lines the text up with the card title */}
      <CardContent className="px-0">
        {session.closedReason != null && session.status === "open" && (
          <p role="alert" className="mb-3 px-(--card-spacing) text-xs text-amber-800 dark:text-amber-300">
            The venue is closed on this date{session.closedReason ? ` (${session.closedReason})` : ""}. Players can no longer book it.
            {(rows ?? []).some((r) => r.status === "confirmed") ? " Cancel the session to refund the players already booked, or reopen the date." : ""}
          </p>
        )}
        {awaiting && !hasEnded(session) && (
          <p role="alert" className="mb-3 px-(--card-spacing) text-xs text-amber-800 dark:text-amber-300">
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
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows === null ? (
              <TableRow><TableCell colSpan={5}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">Nobody has booked this session yet.</TableCell></TableRow>
            ) : (
              rows.map((r) => {
                const name = r.profiles?.full_name || r.customer_name || "Guest Player";
                const method = r.payments[0]?.payment_method;
                const phone = r.profiles?.phone || r.customers?.phone;
                // Awaiting GCash is approved or rejected first; an ended session is not cancelled player by player
                const canCancel = (r.status === "confirmed" || (r.status === "pending" && r.hold_expires_at !== "infinity")) && !hasEnded(session);
                return (
                  <TableRow key={r.id} className={r.status === "cancelled" ? "opacity-60" : ""}>
                    <TableCell>
                      <span className="flex items-center gap-1.5 font-semibold">
                        {r.open_play_spots > 1 ? `${name} +${r.open_play_spots - 1}` : name}
                        {r.profiles?.skill_level && (
                          <Badge variant="secondary" className="text-[10px] font-semibold capitalize">{r.profiles.skill_level}</Badge>
                        )}
                      </span>
                      <span className="block font-mono text-[11px] text-muted-foreground">Ref {bookingRef(r.id)}</span>
                    </TableCell>
                    <TableCell>
                      {phone ? (
                        <a href={`tel:${phone}`} className="hover:underline underline-offset-2">{phone}</a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{method ? (METHODS[method] ?? "QR Ph") : "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs font-semibold">{statusLabel(r)}</Badge></TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <button
                              type="button"
                              aria-label={`Actions for ${name}`}
                              className="inline-flex items-center justify-center rounded-lg h-8 w-8 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                          }
                        >
                          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => setHistoryOf(asBooking(r))} className="cursor-pointer text-xs font-semibold">
                            <History className="mr-2 h-4 w-4" />
                            History
                          </DropdownMenuItem>
                          {canCancel && (
                            <DropdownMenuItem
                              onClick={() => askCancelPlayer(r)}
                              className="cursor-pointer text-destructive focus:text-destructive text-xs font-semibold"
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              Cancel Player
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
      <CancelPaidModal booking={cancelPaid} onClose={() => setCancelPaid(null)} onConfirm={cancelPlayer} />
      <BookingHistoryModal booking={historyOf} onClose={() => setHistoryOf(null)} />
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
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
