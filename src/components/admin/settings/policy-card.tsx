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
import { fetchBookingPolicy } from "@/lib/services/settings/bookingPolicy";

/** The venue's booking rules: when online cancellation closes, and how long staff wait before a no-show. */
export function PolicyCard({ onChanged }: { onChanged: () => void }) {
  const [cutoff, setCutoff] = useState("");
  const [grace, setGrace] = useState("");
  const [saved, setSaved] = useState<{ cutoff: number; grace: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A late second load (dev double effects, slow network) must not overwrite what staff already typed
    let active = true;
    fetchBookingPolicy(supabase).then((p) => {
      if (!active) return;
      setCutoff(String(p.cancelCutoffHours));
      setGrace(String(p.noShowGraceMinutes));
      setSaved({ cutoff: p.cancelCutoffHours, grace: p.noShowGraceMinutes });
    });
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    const c = Number(cutoff), g = Number(grace);
    if (!Number.isInteger(c) || c < 0 || c > 72) return setError("Online cancellation must close between 0 and 72 whole hours before start.");
    if (!Number.isInteger(g) || g < 0 || g > 120) return setError("The no-show grace period must be between 0 and 120 whole minutes.");
    setError(null);
    setSaving(true);
    const { data, error: saveError } = await supabase
      .from("booking_settings")
      .update({ cancel_cutoff_hours: c, no_show_grace_minutes: g })
      .eq("id", true)
      .select("id");
    setSaving(false);
    if (saveError) return setError(saveError.message);
    // RLS can silently match no row: that is not a save
    if (!data?.length) return setError("The booking rules were not saved. Reload the page and try again.");
    setSaved({ cutoff: c, grace: g });
    onChanged();
    toast.success("Booking rules saved.");
  };

  const dirty = !!saved && (Number(cutoff) !== saved.cutoff || Number(grace) !== saved.grace);
  useUnsavedChangesPrompt(dirty);
  if (!saved) return <FormCardSkeleton fields={2} />;

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl font-bold">Booking Rules</CardTitle>
        <CardDescription>
          Applied right away to cancellations and no-shows. The landing page and Terms show the new cutoff within 5 minutes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 max-w-md">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cancel-cutoff">Online cancellation closes (hours before start)</Label>
          <Input id="cancel-cutoff" type="number" min={0} max={72} step={1} value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
          <p className="text-xs text-muted-foreground">After this, players can&apos;t cancel a paid booking online and must ask the desk.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="no-show-grace">No-show grace period (minutes after start)</Label>
          <Input id="no-show-grace" type="number" min={0} max={120} step={1} value={grace} onChange={(e) => setGrace(e.target.value)} />
          <p className="text-xs text-muted-foreground">Staff can mark a no-show only once this has passed.</p>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving || !dirty} className="gap-2 font-bold">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save booking rules
          </Button>
          {dirty && <span className="text-xs text-muted-foreground">You have unsaved changes.</span>}
        </div>
      </CardContent>
    </Card>
  );
}
