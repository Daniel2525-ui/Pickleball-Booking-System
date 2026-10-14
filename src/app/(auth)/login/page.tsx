"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Crosshair, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { login } from "@/lib/services/auth.service";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justRegistered = searchParams.get("registered") === "true";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    setError(null);
    setLoading(true);

    const result = await login(email.trim(), password);

    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push(result.role === "admin" ? "/admin/dashboard" : "/");
    router.refresh();
  }

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-background selection:bg-primary/20 selection:text-primary">
      {/* Back to Home Button */}
      <Link href="/" className="absolute top-4 left-4 sm:top-8 sm:left-8">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground hover:text-foreground text-xs sm:text-sm font-medium"
        >
          <ArrowLeft className="size-4" />
          Back to Courts
        </Button>
      </Link>

      {/* Brand Identity */}
      <Link href="/" className="flex items-center gap-2.5 mb-8 group">
        <div className="flex aspect-square size-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary shadow-xs group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-200">
          <Crosshair className="size-5 transition-transform group-hover:rotate-45" />
        </div>
        <div className="flex flex-col">
          <span className="font-extrabold text-xl tracking-tight leading-none text-foreground">
            Crosshair Dinkers
          </span>
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mt-0.5">
            Butuan City
          </span>
        </div>
      </Link>

      <Card className="w-full max-w-sm shadow-md border border-border bg-card">
        <CardHeader className="text-center pb-4 pt-6">
          <CardTitle className="text-2xl font-extrabold tracking-tight text-foreground">
            Sign In
          </CardTitle>
          <CardDescription className="text-muted-foreground text-xs sm:text-sm leading-relaxed mt-1">
            Access your court reservations, live availability, and player match pass.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            {/* Registration Success Confirmation */}
            {justRegistered && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs sm:text-sm leading-relaxed">
                <CheckCircle2 className="size-4.5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="font-semibold">Account created successfully!</p>
                  <p className="text-xs opacity-90 mt-0.5">
                    Please check your inbox to confirm your email, then sign in below.
                  </p>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm leading-relaxed">
                <AlertCircle className="size-4.5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Sign In Failed</p>
                  <p className="text-xs opacity-90 mt-0.5">{error}</p>
                </div>
              </div>
            )}

            {/* Email Field */}
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
                className="h-10 text-sm"
              />
            </div>

            {/* Password Field */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-xs font-semibold text-foreground">
                  Password
                </Label>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="pr-10 h-10 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full mt-2 h-10 font-bold text-sm shadow-sm hover:shadow transition-all"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Signing In...
                </>
              ) : (
                "Sign In to Account"
              )}
            </Button>

            <div className="pt-2 text-center text-xs text-muted-foreground">
              Don&apos;t have a player account?{" "}
              <Link
                href="/register"
                className="font-bold text-primary hover:underline underline-offset-4"
              >
                Create Account
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Trust & Local Venue Note */}
      <div className="mt-8 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Shield className="size-3.5 text-primary" />
        <span>Secure authentication for Crosshair Dinkers Butuan City</span>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground/70">
        &copy; {new Date().getFullYear()} Crosshair Dinkers. All rights reserved.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
