"use client";

import { useEffect, useState } from "react";
import { useUnsavedChangesPrompt } from "@/hooks/use-unsaved-changes-prompt";
import { FormCardSkeleton } from "@/components/skeletons/form-card-skeleton";
import { Loader2, Save, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { describeSettingsChange, type SettingsChange } from "@/lib/services/settings/settingsChanges";
import { StaffCard } from "./staff-card";
import { PolicyCard } from "./policy-card";
import { ContactCard } from "./contact-card";

const BOTH_OR_NONE = "Enter both the account name and the GCash number, or clear both to turn GCash off.";

export function SettingsContainer() {
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [confirmNumber, setConfirmNumber] = useState("");
  // What is saved now, to tell what changed
  const [saved, setSaved] = useState({ name: "", number: "", qrUrl: null as string | null });
  // A picked QR is only a preview until Save; removing is also applied on Save
  const [pendingQr, setPendingQr] = useState<{ file: File; preview: string } | null>(null);
  const [removeQr, setRemoveQr] = useState(false);
  const [errors, setErrors] = useState<{ form?: string; number?: string; confirm?: string }>({});
  const [history, setHistory] = useState<SettingsChange[] | null>(null);

  const loadHistory = () =>
    supabase
      .from("settings_changes")
      .select("id, changed_at, area, before, after, profiles(full_name)")
      .order("changed_at", { ascending: false })
      .limit(5)
      .then(({ data }) => setHistory((data ?? []) as unknown as SettingsChange[]));

  useEffect(() => {
    // A late second load (dev double effects, slow network) must not overwrite what staff already typed
    let active = true;
    supabase.from("booking_settings").select("gcash_account_name, gcash_number, gcash_qr_url").eq("id", true).single().then(({ data }) => {
      if (!active) return;
      if (data) {
        setName(data.gcash_account_name ?? "");
        setNumber(data.gcash_number ?? "");
        setSaved({ name: data.gcash_account_name ?? "", number: data.gcash_number ?? "", qrUrl: data.gcash_qr_url });
      } else {
        setLoadFailed(true);
      }
      setLoading(false);
    });
    loadHistory();
    return () => {
      active = false;
    };
  }, []);

  const digits = number.replace(/\s/g, "");
  const numberChanged = digits !== saved.number;
  const dirty = name.trim() !== saved.name || numberChanged || !!pendingQr || removeQr;

  useUnsavedChangesPrompt(dirty);

  const pickQr = (file: File) => {
    if (pendingQr) URL.revokeObjectURL(pendingQr.preview);
    setPendingQr({ file, preview: URL.createObjectURL(file) });
    setRemoveQr(false);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed !== !digits) return setErrors({ form: BOTH_OR_NONE });
    if (digits && !/^09\d{9}$/.test(digits)) return setErrors({ number: "Enter an 11-digit GCash number starting with 09." });
    // Customers send money to this number: a new number is typed twice so a wrong digit can't be saved
    if (digits && numberChanged && confirmNumber.replace(/\s/g, "") !== digits) {
      return setErrors({ confirm: "The two GCash numbers don't match. Type the new number again." });
    }
    setErrors({});
    setSaving(true);

    let qrUrl = removeQr ? null : saved.qrUrl;
    if (pendingQr) {
      const ext = (pendingQr.file.name.split(".").pop() || "png").toLowerCase();
      const path = `gcash-qr-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("club-assets").upload(path, pendingQr.file, { contentType: pendingQr.file.type });
      if (error) {
        setSaving(false);
        return setErrors({ form: `The QR image could not be uploaded: ${error.message}` });
      }
      qrUrl = supabase.storage.from("club-assets").getPublicUrl(path).data.publicUrl;
    }

    const { data, error } = await supabase
      .from("booking_settings")
      .update({ gcash_account_name: trimmed || null, gcash_number: digits || null, gcash_qr_url: qrUrl })
      .eq("id", true)
      .select("id");
    setSaving(false);
    if (error) return setErrors({ form: error.message });
    // RLS can silently match no row: that is not a save
    if (!data?.length) return setErrors({ form: "GCash details were not saved. Reload the page and try again." });
    // The replaced or removed QR image is no longer shown anywhere: delete its file (a failure only leaves a stray file)
    const oldPath = saved.qrUrl?.split("/club-assets/")[1];
    if (oldPath && qrUrl !== saved.qrUrl) {
      const { error: removeError } = await supabase.storage.from("club-assets").remove([decodeURIComponent(oldPath)]);
      if (removeError) console.error("Could not delete the old QR image:", removeError);
    }
    setName(trimmed);
    setNumber(digits);
    setConfirmNumber("");
    setSaved({ name: trimmed, number: digits, qrUrl });
    if (pendingQr) URL.revokeObjectURL(pendingQr.preview);
    setPendingQr(null);
    setRemoveQr(false);
    loadHistory();
    toast.success("GCash details saved.");
  };

  if (loading)
    return (
      <div className="flex flex-col gap-6" role="status" aria-label="Loading settings">
        <FormCardSkeleton fields={3} />
        <FormCardSkeleton fields={3} />
        <FormCardSkeleton fields={2} />
        <FormCardSkeleton fields={2} />
      </div>
    );
  if (loadFailed) return <p role="alert" className="text-sm text-destructive">Could not load settings. Reload the page to try again.</p>;

  const qrShown = pendingQr?.preview ?? (removeQr ? null : saved.qrUrl);

  return (
    <div className="flex flex-col gap-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl font-bold">GCash Payments</CardTitle>
          <CardDescription>
            Players see these details on the GCash pay page. Leave the name and number empty to hide GCash at checkout.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 max-w-md">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gcash-name">Account name</Label>
            <Input id="gcash-name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} aria-describedby={errors.form ? "gcash-form-error" : undefined} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gcash-number">GCash number</Label>
            <Input
              id="gcash-number"
              inputMode="numeric"
              placeholder="09171234567"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              aria-invalid={!!errors.number}
              aria-describedby={errors.number ? "gcash-number-error" : errors.form ? "gcash-form-error" : undefined}
            />
            {errors.number && <p id="gcash-number-error" role="alert" className="text-sm text-destructive">{errors.number}</p>}
          </div>
          {digits && numberChanged && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gcash-number-confirm">Confirm GCash number</Label>
              <Input
                id="gcash-number-confirm"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Type the new number again"
                value={confirmNumber}
                onChange={(e) => setConfirmNumber(e.target.value)}
                onPaste={(e) => e.preventDefault()}
                aria-invalid={!!errors.confirm}
                aria-describedby="gcash-number-confirm-hint"
              />
              <p id="gcash-number-confirm-hint" className="text-xs text-muted-foreground">
                Customers will send their payments to this number. Type it again to make sure it is right.
              </p>
              {errors.confirm && <p role="alert" className="text-sm text-destructive">{errors.confirm}</p>}
            </div>
          )}
          {errors.form && <p id="gcash-form-error" role="alert" className="text-sm text-destructive">{errors.form}</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gcash-qr">QR code image</Label>
            <Input
              id="gcash-qr"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickQr(f);
                e.target.value = "";
              }}
            />
            <p className="text-xs text-muted-foreground">JPEG, PNG, WebP or HEIC, up to 5 MB. Scan it with your phone to check it opens the account above.</p>
            {qrShown && (
              <div className="flex items-end gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrShown} alt="GCash QR code" className="size-32 rounded-md border object-contain" />
                {pendingQr ? (
                  <Button variant="outline" onClick={() => { URL.revokeObjectURL(pendingQr.preview); setPendingQr(null); }} className="gap-2">
                    <Undo2 className="size-4" /> Keep current QR
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setRemoveQr(true)} className="gap-2">
                    <Trash2 className="size-4" /> Remove QR
                  </Button>
                )}
              </div>
            )}
            {pendingQr && <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">New QR code: saved when you press Save.</p>}
            {removeQr && (
              <p className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                The QR code will be removed when you press Save.
                <Button variant="ghost" size="sm" className="h-auto gap-1 px-1 py-0 text-xs" onClick={() => setRemoveQr(false)}>
                  <Undo2 className="size-3" /> Undo
                </Button>
              </p>
            )}
          </div>
          <Button onClick={save} disabled={saving} className="gap-2 font-bold self-start">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save GCash details
          </Button>
          {dirty && <p className="text-xs text-muted-foreground">You have unsaved changes.</p>}
        </CardContent>
      </Card>

      <ContactCard onChanged={loadHistory} />

      <PolicyCard onChanged={loadHistory} />

      <StaffCard onChanged={loadHistory} />

      {history && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl font-bold">Recent Changes</CardTitle>
            <CardDescription>Who changed the payment details, contact details, booking rules or staff access, and when. The last five changes, newest first.</CardDescription>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes recorded yet. Changes are recorded from when this feature went live.</p>
            ) : (
              <ol className="space-y-3">
                {history.map((h) => (
                  <li key={h.id} className="border-l-2 border-border pl-3 text-sm">
                    <p>
                      <span className="font-semibold text-foreground">{h.profiles?.full_name?.trim() || "Staff"}</span>
                      <span className="text-muted-foreground">
                        {" · "}
                        {new Date(h.changed_at).toLocaleString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                    </p>
                    <ul className="text-xs text-muted-foreground">
                      {describeSettingsChange(h).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
