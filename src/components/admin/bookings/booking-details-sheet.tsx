"use client";

import { useState } from "react";
import { Phone, Mail, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Booking } from "@/lib/services/bookings/bookingsTypes";
import { formatDate, formatTime12h } from "@/lib/utils/formatTime";
import { bookingRef, bookingTitle } from "@/lib/services/openPlay/bookingTitle";
import { bookingPaymentLabel, paymentMethodLabel } from "@/lib/services/payments/paymentsTypes";
import { BookingHistoryList } from "./bookingHistoryModal";

/** One action the desk can take on a booking: the row menu and the details panel list the same ones. */
export interface BookingAction {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  /** Text colour for the menu item */
  tone?: string;
  destructive?: boolean;
}

const firstPayment = (b: Booking) => (Array.isArray(b.payments) ? b.payments[0] : b.payments) ?? null;

/** Everything about one booking beside the list: who, what, the money, what can be done, and what happened. */
export function BookingDetailsSheet({
  booking,
  status,
  statusClass,
  actions,
  onClose,
  onNoteSaved,
}: {
  booking: Booking | null;
  /** Display status ("confirmed", "hold expired") and its badge colour, as the table shows them */
  status: string;
  statusClass: string;
  actions: BookingAction[];
  onClose: () => void;
  onNoteSaved: (bookingId: string, note: string | null) => void;
}) {
  const payment = booking ? firstPayment(booking) : null;
  const phone = booking?.customers?.phone || booking?.profiles?.phone;
  const email = booking?.customers?.email;
  return (
    <Sheet open={!!booking} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        {booking && (
          <>
            <SheetHeader className="border-b">
              <SheetTitle className="text-xl font-bold">{booking.customer_name || booking.profiles?.full_name || "Guest Player"}</SheetTitle>
              <SheetDescription>
                {booking.customer_id ? "Walk-in guest" : booking.profiles?.is_guest ? "Online guest (no account)" : "Registered player"} · Ref {bookingRef(booking)}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-5 px-4 pb-6">
              {(phone || email) && (
                <div className="flex flex-col gap-2 text-sm">
                  {phone && (
                    <a href={`tel:${phone}`} className="inline-flex items-center gap-2 hover:underline underline-offset-4">
                      <Phone className="size-4 text-primary" aria-hidden />
                      {phone}
                    </a>
                  )}
                  {email && (
                    <a href={`mailto:${email}`} className="inline-flex items-center gap-2 hover:underline underline-offset-4 break-all">
                      <Mail className="size-4 text-primary" aria-hidden />
                      {email}
                    </a>
                  )}
                </div>
              )}

              <section aria-label="Booking" className="rounded-xl border p-4 flex flex-col gap-2 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{booking.open_play_spots ? bookingTitle(booking) : booking.courts?.name ?? "Court"}</p>
                    <p className="text-muted-foreground">
                      {formatDate(booking.booking_date)} · {formatTime12h(booking.start_time)} – {formatTime12h(booking.end_time)}
                    </p>
                  </div>
                  <p className="font-display text-xl font-bold tabular-nums">₱{(booking.total_amount ?? 0).toLocaleString()}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge variant="outline" className={`capitalize ${statusClass}`}>{status}</Badge>
                  {payment && <Badge variant="outline">{bookingPaymentLabel(booking, payment)}</Badge>}
                </div>
                {(booking.player_count || booking.discount_codes?.code) && (
                  <p className="text-xs text-muted-foreground">
                    {booking.player_count ? `${booking.player_count} ${booking.player_count === 1 ? "player" : "players"}` : ""}
                    {booking.player_count && booking.discount_codes?.code ? " · " : ""}
                    {booking.discount_codes?.code ? `Code ${booking.discount_codes.code} · −₱${Number(booking.discount_amount ?? 0).toLocaleString()}` : ""}
                  </p>
                )}
                {payment?.payment_reference && (
                  <p className="text-xs text-muted-foreground">
                    {paymentMethodLabel(payment)} reference <span className="font-mono">{payment.payment_reference}</span>
                  </p>
                )}
              </section>

              {actions.length > 0 && (
                <section aria-label="Actions" className="grid grid-cols-2 gap-2">
                  {actions.map((a) => (
                    <Button
                      key={a.key}
                      type="button"
                      variant={a.destructive ? "outline" : a.key === actions[0].key ? "default" : "outline"}
                      onClick={a.onClick}
                      disabled={a.disabled}
                      title={a.title}
                      className={`h-10 justify-start gap-2 font-semibold ${a.destructive ? "text-destructive border-destructive/30 hover:bg-destructive/10" : ""}`}
                    >
                      <a.icon className="size-4" />
                      {a.label}
                    </Button>
                  ))}
                </section>
              )}

              <BookingNote key={booking.id} booking={booking} onSaved={onNoteSaved} />

              <section aria-label="History">
                <h3 className="text-xs font-bold text-muted-foreground mb-1">History</h3>
                <BookingHistoryList booking={booking} />
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Staff-only note on this booking (deposit taken, bringing a coach...). Empty removes it. */
function BookingNote({ booking, onSaved }: { booking: Booking; onSaved: (bookingId: string, note: string | null) => void }) {
  const saved = booking.booking_notes?.note ?? "";
  const [note, setNote] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/bookings/note", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: booking.id, note }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setSaving(false);
    if (!res?.ok) return setError(body?.error ?? "Could not save the note. Check your connection and try again.");
    toast.success(body.note ? "Note saved." : "Note removed.");
    onSaved(booking.id, body.note);
  };

  return (
    <form onSubmit={save} aria-label="Staff note" className="flex flex-col gap-2">
      <label htmlFor="booking-note" className="text-xs font-bold text-muted-foreground">Staff note <span className="font-normal">(only staff see this)</span></label>
      <textarea
        id="booking-note"
        maxLength={300}
        rows={2}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setError(null);
        }}
        placeholder="e.g. ₱500 deposit taken · Bringing a coach"
        className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
      {note.trim() !== saved && (
        <Button type="submit" size="sm" disabled={saving} className="self-end gap-2 font-semibold">
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {note.trim() ? "Save note" : "Remove note"}
        </Button>
      )}
    </form>
  );
}
