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

/** The venue's booking rules: how long staff wait before a no-show, and how many players a court takes. */
export function PolicyCard({ onChanged }: { onChanged: () => void }) {
  const [grace, setGrace] = useState("");
  const [players, setPlayers] = useState("");
  const [saved, setSaved] = useState<{ grace: number; players: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A late second load (dev double effects, slow network) must not overwrite what staff already typed
    let active = true;
    fetchBookingPolicy(supabase).then((p) => {
      if (!active) return;
      setGrace(String(p.noShowGraceMinutes));
      setPlayers(String(p.maxPlayersPerCourt));
      setSaved({ grace: p.noShowGraceMinutes, players: p.maxPlayersPerCourt });
    });
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    const g = Number(grace);
    if (!Number.isInteger(g) || g < 0 || g > 120) return setError("The no-show grace period must be between 0 and 120 whole minutes.");
    const n = Number(players);
    if (!Number.isInteger(n) || n < 1 || n > 30) return setError("Players per court must be a whole number from 1 to 30.");
    setError(null);
    setSaving(true);
    const { data, error: saveError } = await supabase
      .from("booking_settings")
      .update({ no_show_grace_minutes: g, max_players_per_court: n })
      .eq("id", true)
      .select("id");
    setSaving(false);
    if (saveError) return setError(saveError.message);
    // RLS can silently match no row: that is not a save
    if (!data?.length) return setError("The booking rules were not saved. Reload the page and try again.");
    setSaved({ grace: g, players: n });
    onChanged();
    toast.success("Booking rules saved.");
  };

  const dirty = !!saved && (Number(grace) !== saved.grace || Number(players) !== saved.players);
  useUnsavedChangesPrompt(dirty);
  if (!saved) return <FormCardSkeleton fields={2} />;

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl font-bold">Booking Rules</CardTitle>
        <CardDescription>
          Applied right away to no-shows and new checkouts.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 max-w-md">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="no-show-grace">No-show grace period (minutes after start)</Label>
          <Input id="no-show-grace" type="number" min={0} max={120} step={1} value={grace} onChange={(e) => setGrace(e.target.value)} />
          <p className="text-xs text-muted-foreground">Staff can mark a no-show only once this has passed.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="max-players">Most players per court</Label>
          <Input id="max-players" type="number" min={1} max={30} step={1} value={players} onChange={(e) => setPlayers(e.target.value)} />
          <p className="text-xs text-muted-foreground">Players say how many are coming at checkout; a booking of two courts takes twice this.</p>
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
