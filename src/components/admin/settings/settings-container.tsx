"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";

const BOTH_OR_NONE = "Enter both the account name and the GCash number, or clear both to turn GCash off.";

export function SettingsContainer() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ form?: string; number?: string }>({});

  useEffect(() => {
    supabase.from("booking_settings").select("gcash_account_name, gcash_number, gcash_qr_url").eq("id", true).single().then(({ data }) => {
      if (data) {
        setName(data.gcash_account_name ?? "");
        setNumber(data.gcash_number ?? "");
        setQrUrl(data.gcash_qr_url);
      } else {
        toast.error("Could not load settings.");
      }
      setLoading(false);
    });
  }, []);

  const save = async () => {
    const trimmed = name.trim();
    const digits = number.replace(/\s/g, "");
    if (!trimmed !== !digits) return setErrors({ form: BOTH_OR_NONE });
    if (digits && !/^09\d{9}$/.test(digits)) return setErrors({ number: "Enter an 11-digit GCash number starting with 09." });
    setErrors({});
    setSaving(true);
    const { error } = await supabase
      .from("booking_settings")
      .update({ gcash_account_name: trimmed || null, gcash_number: digits || null })
      .eq("id", true);
    setSaving(false);
    if (error) return setErrors({ form: error.message });
    setName(trimmed);
    setNumber(digits);
    toast.success("GCash details saved.");
  };

  const setQr = async (url: string | null) => {
    const { error } = await supabase.from("booking_settings").update({ gcash_qr_url: url }).eq("id", true);
    if (error) return toast.error(error.message);
    setQrUrl(url);
    toast.success(url ? "QR code saved." : "QR code removed.");
  };

  const upload = async (file: File) => {
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `gcash-qr-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("club-assets").upload(path, file, { contentType: file.type });
    if (error) return toast.error(error.message);
    await setQr(supabase.storage.from("club-assets").getPublicUrl(path).data.publicUrl);
  };

  if (loading) return <Loader2 className="size-6 animate-spin text-primary" />;

  return (
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
        {errors.form && <p id="gcash-form-error" role="alert" className="text-sm text-destructive">{errors.form}</p>}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gcash-qr">QR code image</Label>
          <Input id="gcash-qr" type="file" accept="image/jpeg,image/png,image/webp,image/heic" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          <p className="text-xs text-muted-foreground">JPEG, PNG, WebP or HEIC, up to 5 MB.</p>
          {qrUrl && (
            <div className="flex items-end gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrUrl} alt="GCash QR code" className="size-32 rounded-md border object-contain" />
              <Button variant="outline" onClick={() => setQr(null)} className="gap-2">
                <Trash2 className="size-4" /> Remove QR
              </Button>
            </div>
          )}
        </div>

        <Button onClick={save} disabled={saving} className="gap-2 font-bold self-start">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save GCash details
        </Button>
      </CardContent>
    </Card>
  );
}
