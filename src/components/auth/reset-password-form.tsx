"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { updatePassword } from "@/lib/services/auth.service";

export function ResetPasswordForm() {
  const router = useRouter();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The browser client exchanges the emailed ?code= for a recovery session while it initialises.
  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data }) => setHasSession(Boolean(data.session)));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Same minimum as registration (register-form.tsx)
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const result = await updatePassword(password);
    setLoading(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    toast.success("Password updated. You're signed in.");
    router.push("/");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm shadow-md border border-border bg-card">
      <CardHeader className="text-center pb-4 pt-6">
        <CardTitle className="text-2xl font-extrabold tracking-tight text-foreground">Choose a New Password</CardTitle>
        <CardDescription className="text-muted-foreground text-xs sm:text-sm leading-relaxed mt-1">
          Set the password you&apos;ll use to sign in from now on.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {hasSession === null ? (
          <div className="h-32 flex items-center justify-center">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : !hasSession ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm leading-relaxed">
              <AlertCircle className="size-4.5 shrink-0 mt-0.5" />
              <p className="text-xs">
                This reset link is invalid or has expired. Request a new one and open it in the same browser.
              </p>
            </div>
            <Link href="/forgot-password" className="text-center text-xs font-bold text-primary hover:underline underline-offset-4">
              Request a new link
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm leading-relaxed">
                <AlertCircle className="size-4.5 shrink-0 mt-0.5" />
                <p className="text-xs">{error}</p>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password" className="text-xs font-semibold text-foreground">
                New Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="h-11 text-base sm:text-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirmPassword" className="text-xs font-semibold text-foreground">
                Confirm New Password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="h-11 text-base sm:text-sm"
              />
            </div>

            <Button type="submit" className="w-full mt-2 h-11 font-bold text-sm" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                "Update Password"
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
