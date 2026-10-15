"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Crosshair, Eye, EyeOff, Loader2, AlertCircle, Shield } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Strip misplaced spaces and non-digit characters, limit to 11 digits
    let val = e.target.value.replace(/\D/g, "");
    if (val.startsWith("639") && val.length === 12) {
      val = "0" + val.slice(2);
    }
    setPhone(val.slice(0, 11));
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password is too short. Please choose a password with at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match. Please ensure both password fields are identical.");
      return;
    }

    const sanitizedPhone = phone.replace(/\D/g, "");
    if (sanitizedPhone.length !== 11) {
      setError("Phone number must be exactly 11 digits.");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName.trim(), phone: sanitizedPhone },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // Redirect to login with a success message in the query string
    router.push("/login?registered=true");
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

      <Card className="w-full max-w-sm sm:max-w-md shadow-md border border-border bg-card">
        <CardHeader className="text-center pb-4 pt-6">
          <CardTitle className="text-2xl font-extrabold tracking-tight text-foreground">
            Create Player Account
          </CardTitle>
          <CardDescription className="text-muted-foreground text-xs sm:text-sm leading-relaxed mt-1">
            Sign up to reserve courts, track game sessions, and view live availability in Butuan City.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleRegister} className="flex flex-col gap-4">
            {/* Error Message */}
            {error && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm leading-relaxed">
                <AlertCircle className="size-4.5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Registration Issue</p>
                  <p className="text-xs opacity-90 mt-0.5">{error}</p>
                </div>
              </div>
            )}

            {/* Full Name */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="fullName" className="text-xs font-semibold text-foreground">
                  Full Name
                </Label>
                <span className="text-[11px] text-muted-foreground">Required for check-in</span>
              </div>
              <Input
                id="fullName"
                type="text"
                placeholder="e.g. Juan Dela Cruz"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoComplete="name"
                className="h-10 text-sm"
              />
            </div>

            {/* Mobile Phone Number */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="phone" className="text-xs font-semibold text-foreground">
                  Mobile Number
                </Label>
                <span className="text-[11px] text-muted-foreground">11-digit mobile number</span>
              </div>
              <Input
                id="phone"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]{11}"
                maxLength={11}
                placeholder="09171234567"
                value={phone}
                onChange={handlePhoneChange}
                required
                autoComplete="tel"
                className="h-10 text-sm"
              />
            </div>

            {/* Email Address */}
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

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-xs font-semibold text-foreground">
                  Password
                </Label>
                <span className="text-[11px] text-muted-foreground">Min. 6 characters</span>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Create a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
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

            {/* Confirm Password */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirmPassword" className="text-xs font-semibold text-foreground">
                Confirm Password
              </Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Re-enter password to confirm"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="pr-10 h-10 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                  tabIndex={-1}
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
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
                  Creating Account...
                </>
              ) : (
                "Create Player Account"
              )}
            </Button>

            <div className="pt-2 text-center text-xs text-muted-foreground">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-bold text-primary hover:underline underline-offset-4"
              >
                Sign In
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Trust & Local Venue Note */}
      <div className="mt-8 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Shield className="size-3.5 text-primary" />
        <span>By signing up, you agree to our venue guidelines &amp; booking rules</span>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground/70">
        &copy; {new Date().getFullYear()} Crosshair Dinkers. All rights reserved.
      </p>
    </div>
  );
}
