"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { register } from "@/lib/services/auth.service";

export function RegisterForm() {
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
    const value = e.target.value.replace(/\D/g, "");
    const phone = value.startsWith("639") && value.length === 12
      ? "0" + value.slice(2)
      : value;

    setPhone(phone.slice(0, 11));
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

    try {
      const result = await register(
        email.trim(),
        password,
        fullName.trim(),
        sanitizedPhone
      );

      if (!result.success) {
        setError(result.error);
        return;
      }

      router.push("/login?registered=true");
    } catch {
      setError("Unable to complete registration. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
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
              className="h-11 text-base sm:text-sm"
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
              className="h-11 text-base sm:text-sm"
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
              className="h-11 text-base sm:text-sm"
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
                className="pr-12 h-11 text-base sm:text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors size-9 flex items-center justify-center rounded-lg"
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
                className="pr-12 h-11 text-base sm:text-sm"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors size-9 flex items-center justify-center rounded-lg"
                tabIndex={-1}
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              >
                {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full mt-2 h-11 font-bold text-sm shadow-sm hover:shadow transition-all"
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
  );
}
