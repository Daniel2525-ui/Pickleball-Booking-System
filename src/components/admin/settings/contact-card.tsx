"use client";

import { useEffect, useState } from "react";
import { useUnsavedChangesPrompt } from "@/hooks/use-unsaved-changes-prompt";
import { FormCardSkeleton } from "@/components/skeletons/form-card-skeleton";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { fetchVenueContact } from "@/lib/venue";

type Fields = { phone: string; email: string; address: string };

/** Where players reach the venue: shown on the landing, Terms, Privacy and booking pages. */
export function ContactCard({ onChanged }: { onChanged: () => void }) {
  const [fields, setFields] = useState<Fields | null>(null);
  const [saved, setSaved] = useState<Fields | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A late second load (dev double effects, slow network) must not overwrite what staff already typed
    let active = true;
    fetchVenueContact(supabase).then((v) => {
      if (!active) return;
      const f = { phone: v.phone, email: v.email, address: v.address };
      setFields(f);
      setSaved(f);
    });
    return () => {
      active = false;
    };
  }, []);

  const dirty = !!fields && !!saved && (fields.phone !== saved.phone || fields.email !== saved.email || fields.address !== saved.address);
  useUnsavedChangesPrompt(dirty);
  if (!fields || !saved) return <FormCardSkeleton fields={3} />;

  // Same rules as booking_settings_venue_contact_check
  const save = async () => {
    const f = { phone: fields.phone.trim(), email: fields.email.trim(), address: fields.address.trim() };
    if (!/^[+0-9 ()-]{7,20}$/.test(f.phone) || (f.phone.match(/\d/g)?.length ?? 0) < 7) return setError("Enter a phone number players can call, like +63 917 123 4567.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) || f.email.length > 254) return setError("Enter a valid email address.");
    if (f.address.length < 3 || f.address.length > 200) return setError("Enter the venue address (up to 200 characters).");
    setError(null);
    setSaving(true);
    const { data, error: saveError } = await supabase
      .from("booking_settings")
      .update({ venue_phone: f.phone, venue_email: f.email, venue_address: f.address })
      .eq("id", true)
      .select("id");
    setSaving(false);
    if (saveError) return setError(saveError.message);
    // RLS can silently match no row: that is not a save
    if (!data?.length) return setError("The contact details were not saved. Reload the page and try again.");
    setFields(f);
    setSaved(f);
    onChanged();
    toast.success("Venue contact saved.");
  };

  const field = (key: keyof Fields, label: string, type = "text") => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`venue-${key}`}>{label}</Label>
      <Input id={`venue-${key}`} type={type} value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} />
    </div>
  );

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl font-bold">Venue Contact</CardTitle>
        <CardDescription>
          Players see these on the landing page, Terms, Privacy and their booking pages, and are told to call this number for help.
          Booking pages update at once; the landing page, Terms and Privacy within 5 minutes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 max-w-md">
        {field("phone", "Phone", "tel")}
        {field("email", "Email", "email")}
        {field("address", "Address")}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving || !dirty} className="gap-2 font-bold">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save contact details
          </Button>
          {dirty && <span className="text-xs text-muted-foreground">You have unsaved changes.</span>}
        </div>
      </CardContent>
    </Card>
  );
}
