"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabase";

type ProfileState = { id: string; fullName: string; phone: string; email: string; skillLevel: string } | null | "signed-out";

const LEVELS: Record<string, string> = { "": "Not set", beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

/** Lets a signed-in customer correct the name and mobile number staff use at check-in. */
export function ProfileForm() {
  const [profile, setProfile] = useState<ProfileState>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return setProfile("signed-out");
      const { data } = await supabase.from("profiles").select("full_name, phone, skill_level").eq("id", user.id).maybeSingle();
      setProfile({ id: user.id, fullName: data?.full_name ?? "", phone: data?.phone ?? "", email: user.email ?? "", skillLevel: data?.skill_level ?? "" });
    })();
  }, []);

  if (profile === null) {
    return <Loader2 className="size-8 animate-spin text-primary mx-auto" />;
  }

  if (profile === "signed-out") {
    return (
      <div className="text-center space-y-4">
        <p className="text-sm text-muted-foreground">Sign in to view and edit your profile.</p>
        <Link href="/login"><Button>Sign In</Button></Link>
      </div>
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (profile === null || profile === "signed-out") return;
    setError(null);

    const fullName = profile.fullName.trim();
    if (!fullName) return setError("Full name is required.");
    if (profile.phone.length !== 11) return setError("Phone number must be exactly 11 digits.");

    setSaving(true);
    // .select() so an update RLS silently skipped (0 rows) is reported instead of shown as saved
    const { data: updated, error: updateError } = await supabase
      .from("profiles")
      .update({ full_name: fullName, phone: profile.phone, skill_level: profile.skillLevel || null })
      .eq("id", profile.id)
      .select("id");
    setSaving(false);

    if (updateError || !updated?.length) {
      console.error("Profile update failed:", updateError);
      setError("Could not save your profile. Please try again.");
    } else {
      toast.success("Profile updated.");
    }
  }

  return (
    <Card className="w-full max-w-md mx-auto shadow-md">
      <CardHeader>
        <h1 data-slot="card-title" className="leading-snug text-2xl font-extrabold tracking-tight text-foreground">My Profile</h1>
        <CardDescription>Staff use your name and mobile number to identify you at check-in.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-name" className="text-xs font-semibold">Full Name</Label>
            <Input
              id="profile-name"
              value={profile.fullName}
              onChange={(e) => setProfile({ ...profile, fullName: e.target.value })}
              required
              autoComplete="name"
              className="h-11 text-base sm:text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-phone" className="text-xs font-semibold">Mobile Number</Label>
            <Input
              id="profile-phone"
              type="tel"
              inputMode="numeric"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value.replace(/\D/g, "").slice(0, 11) })}
              required
              autoComplete="tel"
              placeholder="11-digit mobile number"
              className="h-11 text-base sm:text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-level" className="text-xs font-semibold">Skill Level</Label>
            <Select value={profile.skillLevel} onValueChange={(v) => setProfile({ ...profile, skillLevel: v ?? "" })}>
              <SelectTrigger id="profile-level" className="h-11 w-full text-base sm:text-sm">
                <SelectValue>{() => LEVELS[profile.skillLevel] ?? "Not set"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LEVELS).map(([value, label]) => (
                  <SelectItem key={value || "none"} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Helps staff balance open play games.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-email" className="text-xs font-semibold">Email Address</Label>
            <Input id="profile-email" value={profile.email} readOnly disabled className="h-11 text-base sm:text-sm" />
            <p className="text-[11px] text-muted-foreground">Your sign-in email can&apos;t be changed here.</p>
          </div>
          <Button type="submit" disabled={saving} className="h-11 font-bold mt-2">
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save Changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
