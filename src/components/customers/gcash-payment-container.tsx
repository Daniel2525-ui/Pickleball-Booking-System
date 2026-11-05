"use client";

import { useEffect, useState } from "react";
import { HOLD_MS } from "@/lib/services/bookings/bookingDisplayStatus";
import Link from "next/link";
import { CheckCircle2, Copy, Info, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { isAwaitingVerification } from "@/lib/services/bookings/bookingDisplayStatus";
import { useVenueContact } from "@/hooks/use-venue-contact";

const MAX_BYTES = 5 * 1024 * 1024;
const REFERENCE_ERROR = "Enter the reference number from your GCash receipt (6 to 20 letters or digits).";

type Row = { open_play_spots: number | null; total_amount: number | null; booking_date: string; start_time: string; created_at: string; hold_expires_at: string | null };
type Settings = { gcash_account_name: string | null; gcash_number: string | null; gcash_qr_url: string | null };
type View = "loading" | "form" | "submitted" | "expired";

// Same normalisation as submit_gcash_proof: spaces and dashes are ignored
const normaliseReference = (ref: string) => ref.replace(/[\s-]/g, "");
const holdEnd = (r: Row) => new Date(r.hold_expires_at ?? new Date(r.created_at).getTime() + HOLD_MS).getTime();

export const GcashPaymentContainer = ({ basketId }: { basketId: string }) => {
  const venue = useVenueContact();
  const [view, setView] = useState<View>("loading");
  const [rows, setRows] = useState<Row[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const [rowsRes, settingsRes] = await Promise.all([
        supabase
          .from("bookings")
          .select("open_play_spots, total_amount, booking_date, start_time, created_at, hold_expires_at")
          .eq("basket_id", basketId)
          .eq("status", "pending"),
        supabase.from("booking_settings").select("gcash_account_name, gcash_number, gcash_qr_url").maybeSingle(),
      ]);
      const pending = rowsRes.data ?? [];
      setRows(pending);
      setSettings(settingsRes.data);
      if (pending.length === 0) return setView("expired");
      if (pending.some((r) => isAwaitingVerification({ status: "pending", created_at: r.created_at, hold_expires_at: r.hold_expires_at }))) {
        return setView("submitted");
      }
      // The resume path skips the server's expiry checks, so repeat them: hold timer and match start (Asia/Manila)
      const now = Date.now();
      const holdOver = pending.some((r) => holdEnd(r) <= now);
      const started = Math.min(...pending.map((r) => new Date(`${r.booking_date}T${r.start_time}+08:00`).getTime())) <= now;
      setView(holdOver || started ? "expired" : "form");
    };
    load();
  }, [basketId]);

  const spotBuyer = rows.some((r) => r.open_play_spots);
  const total = rows.reduce((sum, r) => sum + Number(r.total_amount ?? 0), 0);
  const referenceValid = /^[A-Za-z0-9]{6,20}$/.test(normaliseReference(reference));
  const canSubmit = referenceValid && file !== null && !fileError && !submitting;

  const pickFile = (f: File | null) => {
    setFile(f);
    setFileError(f && !f.type.startsWith("image/") ? "Choose an image file." : f && f.size > MAX_BYTES ? "The image must be 5 MB or smaller." : null);
  };

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(settings?.gcash_number ?? "");
      toast.success("GCash number copied");
    } catch {
      toast.error("Could not copy. Select the number and copy it manually.");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !file) return;
    setSubmitting(true);
    setReferenceError(null);
    setFormError(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in again.");
      const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${user.id}/${basketId}-${Date.now()}.${ext}`;
      // Players can only INSERT into their folder (no read-back), so never upsert
      // shortcut: a failed submit leaves this file behind (players can't delete it), add an admin sweep of unreferenced receipts if storage grows
      const { error: uploadError } = await supabase.storage.from("gcash-receipts").upload(path, file);
      if (uploadError) throw uploadError;
      const { error } = await supabase.rpc("submit_gcash_proof", { p_basket_id: basketId, p_reference: reference.trim(), p_proof_path: path });
      if (error) {
        if (error.message.includes("HOLD_EXPIRED")) return setView("expired");
        if (error.message.includes("ALREADY_SUBMITTED")) return setView("submitted");
        if (error.message.includes("INVALID_ARGUMENT")) return setReferenceError(REFERENCE_ERROR);
        throw error;
      }
      setView("submitted");
    } catch {
      setFormError("We could not submit your payment. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (view === "loading") return <LoaderCircle className="size-8 animate-spin text-primary mt-16" aria-label="Loading" />;

  if (view === "expired") {
    return (
      <div className="max-w-lg w-full bg-card border border-destructive/20 rounded-2xl shadow-md p-6 sm:p-8 text-center space-y-4">
        <Info className="size-10 text-destructive mx-auto" />
        <h1 className="text-2xl font-extrabold tracking-tight">This reservation has expired</h1>
        <p className="text-sm text-muted-foreground">{spotBuyer ? "The hold on your spots has ended. Pick a session to book again." : "The hold on your courts has ended. Pick a new time to book again."}</p>
        <p className="text-sm text-muted-foreground">Already sent the money? Contact the club at <a href={venue.phoneHref} className="font-semibold text-foreground">{venue.phone}</a> with your GCash reference.</p>
        <Link href="/book" className="block"><Button className="w-full h-11 font-bold">Book again</Button></Link>
      </div>
    );
  }

  if (view === "submitted") {
    return (
      <div className="max-w-lg w-full bg-card border border-border rounded-2xl shadow-md p-6 sm:p-8 text-center space-y-4">
        <CheckCircle2 className="size-10 text-emerald-600 dark:text-emerald-400 mx-auto" />
        <h1 className="text-2xl font-extrabold tracking-tight">Payment submitted</h1>
        <p className="text-sm text-muted-foreground">The club will check your GCash payment and confirm your booking. Your {spotBuyer ? "spots stay" : "courts stay"} held until then.</p>
        <Link href="/my-bookings" className="block"><Button className="w-full h-11 font-bold">View My Bookings</Button></Link>
      </div>
    );
  }

  if (!settings?.gcash_number) {
    return (
      <div className="max-w-lg w-full bg-card border border-border rounded-2xl shadow-md p-6 sm:p-8 text-center space-y-4">
        <Info className="size-10 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">GCash payment is unavailable right now. Cancel this booking in My Bookings and book with Card.</p>
        <Link href="/my-bookings" className="block"><Button className="w-full h-11 font-bold">View My Bookings</Button></Link>
      </div>
    );
  }

  const heldUntil = new Date(Math.min(...rows.map(holdEnd))).toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });

  return (
    <form onSubmit={submit} className="max-w-lg w-full bg-card border border-border rounded-2xl shadow-md p-6 sm:p-8 space-y-5">
      <h1 className="text-2xl font-extrabold tracking-tight">Send exactly ₱{total.toLocaleString()}</h1>
      <p className="text-sm text-muted-foreground">Your {spotBuyer ? "spots are" : "courts are"} held until {heldUntil}.</p>
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3 text-sm">
        {settings?.gcash_qr_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={settings.gcash_qr_url} alt="GCash QR code" className="mx-auto size-48 object-contain" />
        )}
        <p><span className="text-muted-foreground">Account name</span><br /><strong>{settings?.gcash_account_name}</strong></p>
        <div className="flex items-center justify-between gap-2">
          <p><span className="text-muted-foreground">GCash number</span><br /><strong>{settings?.gcash_number}</strong></p>
          <Button type="button" variant="outline" size="sm" onClick={copyNumber} aria-label="Copy GCash number"><Copy className="size-4" />Copy</Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="gcash-reference">GCash reference number</Label>
        <Input
          id="gcash-reference"
          value={reference}
          onChange={(e) => { setReference(e.target.value); setReferenceError(null); }}
          autoComplete="off"
          required
          aria-invalid={referenceError ? true : undefined}
          aria-describedby={referenceError ? "gcash-reference-error" : undefined}
        />
        {referenceError && <p id="gcash-reference-error" role="alert" className="text-xs text-destructive">{referenceError}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="gcash-proof">Payment screenshot</Label>
        <Input
          id="gcash-proof"
          type="file"
          accept="image/*"
          required
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          aria-invalid={fileError ? true : undefined}
          aria-describedby={fileError ? "gcash-proof-error" : undefined}
        />
        {fileError && <p id="gcash-proof-error" role="alert" className="text-xs text-destructive">{fileError}</p>}
      </div>

      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
      <Button type="submit" className="w-full h-11 font-bold" disabled={!canSubmit} aria-describedby="gcash-submit-hint">
        {submitting && <LoaderCircle className="size-4 animate-spin" />}Submit payment
      </Button>
      {!canSubmit && !submitting && <p id="gcash-submit-hint" className="text-xs text-muted-foreground text-center">Enter your reference number and add a screenshot to submit.</p>}
    </form>
  );
};
