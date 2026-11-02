"use client";

import { useEffect, useState } from "react";
import { Loader2, Search, UserCheck, UserPlus, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { searchCustomers } from "@/lib/services/customers/searchCustomers.service";
import { createWalkInCustomer } from "@/lib/services/customers/createWalkInCustomer.service";
import { UnifiedCustomerResult } from "@/lib/services/customers/customersTypes";
import { formatTime12h } from "@/lib/utils/formatTime";
import type { OpenPlayAdminSession } from "./open-play-container";

interface Props {
  session: OpenPlayAdminSession;
  onClose: () => void;
  onAdded: () => void;
}

export function AddWalkupModal({ session, onClose, onAdded }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UnifiedCustomerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [player, setPlayer] = useState<UnifiedCustomerResult | null>(null);
  const [spots, setSpots] = useState("1");
  const [method, setMethod] = useState<"cash" | "gcash">("cash");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced customer search, as in the new-reservation modal
  useEffect(() => {
    if (player) return;
    const timer = setTimeout(async () => {
      setSearching(true);
      const { data } = await searchCustomers(query);
      // The walk-up RPC takes a customers record, so online members are not offered
      setResults(data.filter((c) => c.type === "walk_in"));
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, player]);

  const createFromQuery = async () => {
    setError(null);
    setSaving(true);
    const { data, error: err } = await createWalkInCustomer({ fullName: query });
    setSaving(false);
    if (err || !data) return setError(err?.message || "Failed to create customer record.");
    setPlayer({ ...data, full_name: data.full_name, type: "walk_in" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!player) return setError("Search and select a player, or add a new walk-in.");
    setSaving(true);
    const res = await fetch("/api/admin/open-play/walkup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        customerId: player.id,
        customerName: player.full_name,
        spots: Number(spots),
        payment_method: method,
        payment_reference: method === "gcash" ? reference : undefined,
      }),
    });
    setSaving(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Could not add the player.");
    toast.success("Player added.");
    onAdded();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[460px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add player</DialogTitle>
          <DialogDescription>
            Record a walk-up for {session.session_date} · {formatTime12h(session.start_time)}. Payment is taken at the counter.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          {player ? (
            <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <UserCheck className="size-4 text-primary" />
                <div className="flex flex-col">
                  <span className="font-semibold text-sm">{player.full_name}</span>
                  <span className="text-xs text-muted-foreground">{player.phone || player.email || "Walk-in Guest"}</span>
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPlayer(null)}>Change</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="walkup-search" className="text-xs font-semibold">Player</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground pointer-events-none" />
                <Input id="walkup-search" placeholder="Search walk-in players by name or phone..." value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8 h-9" />
              </div>
              <div className="max-h-[140px] overflow-y-auto border border-border rounded-lg divide-y divide-border/60 bg-card">
                {searching ? (
                  <div className="p-3 text-center text-xs text-muted-foreground flex items-center justify-center gap-2"><Loader2 className="size-3.5 animate-spin" />Searching players...</div>
                ) : results.length === 0 ? (
                  <div className="p-3 text-center text-xs text-muted-foreground">{query ? "No matching walk-in players." : "Type a name or phone to search..."}</div>
                ) : (
                  results.map((c) => (
                    <button key={c.id} type="button" onClick={() => setPlayer(c)} className="w-full p-2.5 text-left text-xs hover:bg-muted/50 flex items-center justify-between">
                      <span className="flex flex-col">
                        <span className="font-semibold">{c.full_name}</span>
                        <span className="text-[11px] text-muted-foreground">{c.phone || c.email || "No contact info"}</span>
                      </span>
                      <Badge variant="outline" className="text-[10px]">Walk-in</Badge>
                    </button>
                  ))
                )}
              </div>
              {query.trim() && (
                <Button type="button" variant="outline" size="sm" className="gap-2 self-start" disabled={saving} onClick={createFromQuery}>
                  <UserPlus className="size-3.5" />
                  Add &quot;{query.trim()}&quot; as a new walk-in
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="walkup-spots" className="text-xs font-semibold">Spots (1 to 4)</Label>
            <Input id="walkup-spots" type="number" min={1} max={4} step={1} value={spots} onChange={(e) => setSpots(e.target.value)} required />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-semibold mb-1">Payment collected</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["cash", "gcash"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={method === m}
                  onClick={() => setMethod(m)}
                  className={`p-2.5 rounded-lg border text-xs font-semibold transition-colors ${method === m ? "border-primary bg-primary/10 text-foreground font-bold" : "border-border text-muted-foreground hover:bg-muted/50"}`}
                >
                  {m === "cash" ? "Cash" : "GCash"}
                </button>
              ))}
            </div>
            {method === "gcash" && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="walkup-ref" className="text-[11px] font-medium text-muted-foreground">GCash reference no.</Label>
                <Input id="walkup-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 1029384756" required />
              </div>
            )}
          </fieldset>

          <DialogFooter>
            <Button type="submit" disabled={saving} className="gap-2 font-bold">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Adding..." : "Add player"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
