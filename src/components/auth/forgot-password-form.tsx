"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/services/auth.service";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await requestPasswordReset(email);

    setLoading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setSent(true);
  }

  return (
    <Card className="w-full max-w-sm shadow-md border border-border bg-card">
      <CardHeader className="text-center pb-4 pt-6">
        <CardTitle className="text-2xl font-extrabold tracking-tight text-foreground">Reset Password</CardTitle>
        <CardDescription className="text-muted-foreground text-xs sm:text-sm leading-relaxed mt-1">
          Enter your account email and we&apos;ll send you a link to choose a new password.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {sent ? (
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs sm:text-sm leading-relaxed">
            <CheckCircle2 className="size-4.5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Check your inbox</p>
              <p className="text-xs opacity-90 mt-0.5">
                If an account exists for {email.trim()}, a reset link is on its way. Open it in this browser.
              </p>
            </div>
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
              <Label htmlFor="email" className="text-xs font-semibold text-foreground">
                Email Address
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="player@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="h-11 text-base sm:text-sm"
              />
            </div>

            <Button type="submit" className="w-full mt-2 h-11 font-bold text-sm" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Sending...
                </>
              ) : (
                "Send Reset Link"
              )}
            </Button>
          </form>
        )}

        <div className="pt-4 text-center text-xs text-muted-foreground">
          <Link href="/login" className="font-bold text-primary hover:underline underline-offset-4">
            Back to Sign In
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
