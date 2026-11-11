"use client";

import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog, ConfirmRequest } from "@/components/ui/confirm-dialog";
import { supabase } from "@/lib/supabase";

type Access = "owner" | "staff" | "none";

interface StaffMember {
  id: string;
  full_name: string | null;
  email: string | null;
  is_owner: boolean;
}

const LABEL: Record<Access, string> = { owner: "Admin", staff: "Front desk", none: "No access" };

// set_staff_access refusals in staff wording
const staffError = (message: string) =>
  message.includes("CANNOT_CHANGE_SELF") ? "You can't change your own access. Ask another admin to do it."
  : message.includes("LAST_OWNER") ? "The venue must keep at least one admin."
  : message.includes("FORBIDDEN") ? "Only an admin can change staff access."
  : "Could not change staff access. Please try again.";

const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";

/** Who can open the admin pages: admins (stored as owner) see everything, front desk everything except Pricing and Settings. */
export function StaffCard({ onChanged }: { onChanged: () => void }) {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [newAccess, setNewAccess] = useState<Access>("staff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email, is_owner")
      .eq("role", "admin")
      .order("is_owner", { ascending: false })
      .order("full_name");
    setStaff((data ?? []) as StaffMember[]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() sets state after its await
    load();
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, [load]);

  const setAccess = async (id: string, access: Access, label: string) => {
    setBusy(true);
    const { error: rpcError } = await supabase.rpc("set_staff_access", { p_user_id: id, p_access: access });
    setBusy(false);
    if (rpcError) {
      toast.error(staffError(rpcError.message));
      return false;
    }
    toast.success(access === "none" ? `${label} no longer has staff access.` : `${label} now has ${LABEL[access].toLowerCase()} access.`);
    load();
    onChanged();
    return true;
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const wanted = email.trim().toLowerCase();
    if (!wanted) return setError("Enter the email of the player account.");
    // Exact match: a pattern match would read "_" in an email as "any character" and could pick someone else
    const { data } = await supabase.from("profiles").select("id, email, role").eq("email", wanted).limit(1);
    const account = data?.[0];
    if (!account) return setError("No player account uses that email. Ask them to sign up on the booking site and confirm their email first.");
    if (account.role === "admin") return setError("That account already has staff access. Change its access in the list above.");
    if (await setAccess(account.id, newAccess, account.email ?? wanted)) setEmail("");
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl font-bold">Access Control</CardTitle>
        <CardDescription>
          Admins can use every admin page. Front desk can use everything except Pricing and Settings. Remove access as
          soon as someone leaves; it takes effect on their next action.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 max-w-xl">
        {staff === null ? (
          <div className="divide-y divide-border rounded-xl border" aria-hidden="true">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-44" />
                </div>
                <Skeleton className="h-9 w-28" />
              </div>
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-xl border">
            {staff.map((s) => {
              const access: Access = s.is_owner ? "owner" : "staff";
              const label = s.full_name || s.email || "That account";
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="block font-semibold truncate">
                      {s.full_name || "Staff"}
                      {s.id === me && <span className="font-normal text-muted-foreground"> (you)</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground truncate">{s.email}</span>
                  </span>
                  {s.id === me ? (
                    <span className="text-xs font-semibold text-muted-foreground">{LABEL[access]}</span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <select
                        className={selectClass}
                        value={access}
                        disabled={busy}
                        aria-label={`Access for ${s.email ?? s.full_name}`}
                        onChange={(e) => setAccess(s.id, e.target.value as Access, label)}
                      >
                        <option value="owner">Admin</option>
                        <option value="staff">Front desk</option>
                      </select>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        className="gap-1 text-destructive"
                        aria-label={`Remove staff access for ${s.email ?? s.full_name}`}
                        onClick={() =>
                          setConfirmRequest({
                            title: "Remove staff access?",
                            description: `${label} will no longer be able to open the admin pages. Their player account stays.`,
                            confirmLabel: "Remove Access",
                            onConfirm: () => setAccess(s.id, "none", label),
                          })
                        }
                      >
                        <UserMinus className="size-4" /> Remove
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={add} className="flex flex-col gap-1.5">
          <Label htmlFor="staff-email">Give staff/admin access</Label>
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
            <select
              className={selectClass}
              value={newAccess}
              onChange={(e) => setNewAccess(e.target.value as Access)}
              aria-label="Access to give"
            >
              <option value="staff">Front desk</option>
              <option value="owner">Admin</option>
            </select>
            <Button type="submit" disabled={busy} className="gap-2 shrink-0">
              <UserPlus className="size-4" /> Give access
            </Button>
          </div>
          {error && <p id="staff-email-error" role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
      </CardContent>
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </Card>
  );
}
