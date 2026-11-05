"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog, ConfirmRequest } from "@/components/ui/confirm-dialog";
import { supabase } from "@/lib/supabase";

interface StaffMember {
  id: string;
  full_name: string | null;
  email: string | null;
}

// set_staff_access refusals in staff wording
const staffError = (message: string) =>
  message.includes("CANNOT_REMOVE_SELF") ? "You can't remove your own staff access. Ask another staff member to do it."
  : message.includes("LAST_STAFF") ? "The venue must keep at least one staff account."
  : message.includes("FORBIDDEN") ? "Only staff can change staff access."
  : "Could not change staff access. Please try again.";

/** Who can open the admin pages: give a player account staff access, or take it away. */
export function StaffCard({ onChanged }: { onChanged: () => void }) {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("id, full_name, email").eq("role", "admin").order("full_name");
    setStaff((data ?? []) as StaffMember[]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets state after its await
    load();
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, [load]);

  const setAccess = async (id: string, isStaff: boolean, label: string) => {
    setBusy(true);
    const { error: rpcError } = await supabase.rpc("set_staff_access", { p_user_id: id, p_is_staff: isStaff });
    setBusy(false);
    if (rpcError) {
      toast.error(staffError(rpcError.message));
      return false;
    }
    toast.success(isStaff ? `${label} now has staff access.` : `${label} no longer has staff access.`);
    load();
    onChanged();
    return true;
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const wanted = email.trim().toLowerCase();
    if (!wanted) return setError("Enter the email of the player account.");
    const { data } = await supabase.from("profiles").select("id, email, role").ilike("email", wanted).limit(1);
    const account = data?.[0];
    if (!account) return setError("No player account uses that email. Ask them to sign up on the booking site first.");
    if (account.role === "admin") return setError("That account already has staff access.");
    if (await setAccess(account.id, true, account.email ?? wanted)) setEmail("");
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl font-bold">Staff</CardTitle>
        <CardDescription>
          Staff can open every admin page. Remove access as soon as someone leaves; it takes effect on their next action.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 max-w-xl">
        {staff === null ? (
          <Loader2 className="size-5 animate-spin text-primary" />
        ) : (
          <ul className="divide-y divide-border rounded-xl border">
            {staff.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-semibold truncate">
                    {s.full_name || "Staff"}
                    {s.id === me && <span className="font-normal text-muted-foreground"> (you)</span>}
                  </span>
                  <span className="block text-xs text-muted-foreground truncate">{s.email}</span>
                </span>
                {s.id !== me && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    className="gap-1 text-destructive"
                    aria-label={`Remove staff access for ${s.email ?? s.full_name}`}
                    onClick={() =>
                      setConfirmRequest({
                        title: "Remove staff access?",
                        description: `${s.full_name || s.email} will no longer be able to open the admin pages. Their player account stays.`,
                        confirmLabel: "Remove Access",
                        onConfirm: () => setAccess(s.id, false, s.full_name || s.email || "That account"),
                      })
                    }
                  >
                    <UserMinus className="size-4" /> Remove access
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={add} className="flex flex-col gap-1.5">
          <Label htmlFor="staff-email">Give staff access</Label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              id="staff-email"
              type="email"
              placeholder="Email of their player account"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              aria-describedby={error ? "staff-email-error" : undefined}
            />
            <Button type="submit" disabled={busy} className="gap-2 shrink-0">
              <UserPlus className="size-4" /> Give staff access
            </Button>
          </div>
          {error && <p id="staff-email-error" role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
      </CardContent>
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </Card>
  );
}
