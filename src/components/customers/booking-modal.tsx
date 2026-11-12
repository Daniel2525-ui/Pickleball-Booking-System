import { useState } from "react";
import { useVenueContact } from "@/hooks/use-venue-contact";
import { AlertCircle, LoaderCircle, MapPin, Minus, Plus, QrCode, Tag } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { basketTotal } from "@/lib/services/bookings/basket";
import { checkPlayerCount, parseGuestDetails, type GuestDetails } from "@/lib/services/bookings/guestDetails";
import { Slot } from "./types";
import { VENUE_NAME } from "@/lib/brand";

/** What the player filled in: their details (guests only), the number of players and an applied code */
export interface CheckoutDetails {
  guest: GuestDetails | null;
  playerCount: number;
  discountCode: string | null;
}

interface BookingModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  lines: Slot[];
  isLoading?: boolean;
  error?: string | null;
  onConfirm: (details: CheckoutDetails) => void;
  /** No account: ask for name, mobile number and email */
  isGuest: boolean;
  /** Most players this checkout takes (per-court limit × courts) */
  maxPlayers: number;
  /** Each stored booking's price, as the server holds them (a run over midnight is two); the code preview uses these */
  checkoutAmounts?: number[];
  /** "Sign in" or "Create an account": keeps the courts and goes to that page */
  onSignIn: (page: "/login" | "/register") => void;
}

const hrs = (n: number) => `${n} ${n === 1 ? "hour" : "hours"}`;

/**
 * Checkout: what is being bought, the player's details (guests), number of players, a discount code, how QR Ph
 * payment works, the policy, and one button that names the amount.
 */
export const BookingModal = ({ isOpen, onOpenChange, lines, isLoading, error, onConfirm, isGuest, maxPlayers, onSignIn, checkoutAmounts }: BookingModalProps) => {
  const venue = useVenueContact();
  const [agreed, setAgreed] = useState(true);
  const [guest, setGuest] = useState({ full_name: "", phone: "", email: "" });
  const [players, setPlayers] = useState(4);
  const [codeInput, setCodeInput] = useState("");
  const [applied, setApplied] = useState<{ code: string; discount: number; forAmounts: string } | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [checkingCode, setCheckingCode] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { total: subtotal, hasPeak } = basketTotal(lines);
  const totalHours = lines.reduce((sum, l) => sum + (l.duration || 1), 0);
  // A code is worth what it was checked against: a changed basket needs it applied again
  const amounts = checkoutAmounts?.length ? checkoutAmounts : lines.map((l) => l.price);
  const code = applied && applied.forAmounts === amounts.join(",") ? applied : null;
  const total = code ? subtotal - code.discount : subtotal;
  const playerCount = Math.max(1, Math.min(players, maxPlayers));

  const applyCode = async () => {
    setCodeError(null);
    setCheckingCode(true);
    try {
      const res = await fetch("/api/discount-codes/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeInput, amounts }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) setCodeError(data?.error ?? "Could not check the code. Please try again.");
      else if (!data.valid) setCodeError(data.reason);
      else setApplied({ code: data.code, discount: Number(data.discount), forAmounts: amounts.join(",") });
    } catch {
      setCodeError("Could not check the code. Please try again.");
    } finally {
      setCheckingCode(false);
    }
  };

  const pay = () => {
    setFormError(null);
    const parsed = isGuest ? parseGuestDetails(guest) : null;
    if (parsed && !parsed.ok) return setFormError(parsed.error);
    const playersError = checkPlayerCount(playerCount, maxPlayers);
    if (playersError) return setFormError(playersError);
    onConfirm({ guest: parsed?.ok ? parsed.value : null, playerCount, discountCode: code?.code ?? null });
  };

  const shownError = formError || error;
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="p-5 sm:p-6 border-b">
          <DialogTitle className="text-2xl font-bold">Review and pay</DialogTitle>
          <DialogDescription>
            {lines.length} {lines.length === 1 ? "court" : "courts"} · {hrs(totalHours)} · {VENUE_NAME}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <section aria-label="Your booking" className="flex flex-col gap-3">
            {lines.length > 0 && (
              <p className="text-sm font-semibold">
                {lines[0].date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {lines.map((line) => (
                <li key={`${line.court}|${line.time}`} className="rounded-xl border p-3.5 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{line.court}</p>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      {line.time} · {hrs(line.duration || 1)}
                      {line.hasPeak && " · peak"}
                    </p>
                  </div>
                  <p className="font-bold tabular-nums">₱{line.price.toLocaleString()}</p>
                </li>
              ))}
            </ul>
            {code && (
              <div className="flex items-baseline justify-between border-t pt-3 text-sm">
                <span className="inline-flex items-center gap-1.5 font-semibold text-primary">
                  <Tag className="size-4" aria-hidden />
                  Code {code.code}
                </span>
                <span className="font-semibold tabular-nums text-primary">−₱{code.discount.toLocaleString()}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t pt-3">
              <span className="text-sm text-muted-foreground">Total{hasPeak ? " · includes peak rate" : ""}</span>
              <span className="font-display text-3xl font-bold tabular-nums">₱{total.toLocaleString()}</span>
            </div>
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="size-4 shrink-0 text-primary mt-0.5" aria-hidden />
              <span>{VENUE_NAME}, {venue.address}</span>
            </p>
          </section>

          <div className="flex flex-col gap-4">
            {isGuest && (
              <section aria-labelledby="guest-details-title" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 id="guest-details-title" className="font-semibold">Your details</h3>
                  <span className="text-sm">
                    <button type="button" onClick={() => onSignIn("/login")} className="font-semibold text-primary hover:underline underline-offset-4">
                      Have an account? Sign in
                    </button>
                    <span className="text-muted-foreground"> or </span>
                    <button type="button" onClick={() => onSignIn("/register")} className="font-semibold text-primary hover:underline underline-offset-4">
                      create one
                    </button>
                  </span>
                </div>
                <p className="-mt-2 text-sm text-muted-foreground">For your confirmation and receipt. No account needed.</p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="guest-name">Full name</Label>
                  <Input id="guest-name" autoComplete="name" value={guest.full_name} onChange={(e) => setGuest({ ...guest, full_name: e.target.value })} placeholder="Juan Dela Cruz" className="h-11" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="guest-phone">Mobile number</Label>
                    <Input id="guest-phone" type="tel" inputMode="tel" autoComplete="tel" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} placeholder="0917 123 4567" className="h-11" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="guest-email">Email</Label>
                    <Input id="guest-email" type="email" autoComplete="email" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} placeholder="you@example.com" className="h-11" />
                  </div>
                </div>
              </section>
            )}

            <section aria-label="Players" className="flex items-center justify-between gap-3 rounded-xl border p-3.5">
              <div>
                <p id="players-label" className="font-semibold">Number of players</p>
                <p className="text-xs text-muted-foreground">Up to {maxPlayers}</p>
              </div>
              <div role="group" aria-labelledby="players-label" className="flex items-center gap-1">
                <Button type="button" variant="outline" size="icon" className="size-10" aria-label="One player fewer" disabled={playerCount <= 1} onClick={() => setPlayers(playerCount - 1)}>
                  <Minus className="size-4" />
                </Button>
                <output aria-live="polite" className="w-10 text-center text-lg font-bold tabular-nums">{playerCount}</output>
                <Button type="button" variant="outline" size="icon" className="size-10" aria-label="One player more" disabled={playerCount >= maxPlayers} onClick={() => setPlayers(playerCount + 1)}>
                  <Plus className="size-4" />
                </Button>
              </div>
            </section>

            <section aria-label="Discount code" className="flex flex-col gap-1.5">
              <Label htmlFor="discount-code">Discount code</Label>
              <div className="flex gap-2">
                <Input
                  id="discount-code"
                  value={code ? code.code : codeInput}
                  onChange={(e) => {
                    setCodeInput(e.target.value);
                    setCodeError(null);
                  }}
                  disabled={!!code}
                  placeholder="Enter code"
                  className="h-11 uppercase"
                  aria-invalid={!!codeError}
                  aria-describedby={codeError ? "discount-code-error" : undefined}
                />
                {code ? (
                  <Button type="button" variant="outline" className="h-11" onClick={() => { setApplied(null); setCodeInput(""); }}>
                    Remove
                  </Button>
                ) : (
                  <Button type="button" variant="outline" className="h-11" disabled={!codeInput.trim() || checkingCode} onClick={applyCode}>
                    {checkingCode ? <LoaderCircle className="size-4 animate-spin" aria-label="Checking" /> : "Apply"}
                  </Button>
                )}
              </div>
              {codeError && <p id="discount-code-error" role="alert" className="text-sm text-destructive">{codeError}</p>}
            </section>

            <section aria-label="Payment method" className="rounded-xl border-2 border-primary bg-primary/5 p-4 flex gap-3">
              <QrCode className="size-6 text-primary shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">Pay with QR Ph</p>
                <p className="text-sm text-muted-foreground">GCash, Maya or any bank app. No fee.</p>
                <ol className="mt-2 list-decimal pl-4 text-sm text-muted-foreground space-y-0.5">
                  <li>Tap <b className="text-foreground">Pay</b> and a QR code appears.</li>
                  <li>Scan it in your app, or save it and upload it from your photos.</li>
                  <li>Keep the page open. We confirm your booking automatically.</li>
                </ol>
              </div>
            </section>

            <section aria-label="Before you pay" className="text-sm flex flex-col gap-2">
              <p><b>Paid bookings can&apos;t be cancelled online.</b> To move one, call {venue.phone}.</p>
              <p className="text-muted-foreground">Your courts are held for 15 minutes while you pay. Please arrive 10 minutes early.</p>
              <label className="flex items-center gap-2.5 min-h-11 cursor-pointer">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="size-5 accent-[var(--primary)]" />
                <span>
                  I agree to the <Link href="/terms" className="font-semibold text-primary underline underline-offset-4">booking rules</Link>
                </span>
              </label>
            </section>
          </div>
        </div>

        {shownError && (
          <div role="alert" className="mx-5 sm:mx-6 mb-4 bg-destructive/10 text-destructive text-sm p-3 rounded-lg flex items-start gap-2">
            <AlertCircle className="size-4 mt-0.5 shrink-0" />
            <p>{shownError}</p>
          </div>
        )}

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2 p-5 sm:p-6 border-t bg-muted/30">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto h-12 font-semibold" disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={pay} className="w-full sm:w-auto h-12 px-6 text-base font-semibold gap-2" disabled={isLoading || !agreed}>
            {isLoading ? <LoaderCircle className="size-4 animate-spin" /> : <QrCode className="size-4" />}
            {isLoading ? "Creating your QR code..." : `Pay ₱${total.toLocaleString()} with QR Ph`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
