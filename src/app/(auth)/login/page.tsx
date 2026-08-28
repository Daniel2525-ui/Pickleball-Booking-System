"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Crosshair, Eye, EyeOff, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { login } from "@/lib/services/auth.service"

export default function LoginPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const justRegistered = searchParams.get("registered") === "true"
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault()

        setError(null)
        setLoading(true)

        const result = await login(email, password)

        if (!result.success) {
            setError(result.error)
            setLoading(false)
            return
        }

        router.push(
            result.role === "admin"
                ? "/admin/dashboard"
                : "/"
        )

        router.refresh()
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-background">
            {/* Logo */}
            <div className="flex items-center gap-2 mb-8">
                <div className="flex aspect-square size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                    <Crosshair className="size-5" />
                </div>
                <span className="font-bold text-xl tracking-tight">Crosshair Dinkers</span>
            </div>

            <Card className="w-full max-w-sm shadow-lg border">
                <CardHeader className="text-center pb-4">
                    <CardTitle className="text-2xl font-bold tracking-tight">Welcome back</CardTitle>
                    <CardDescription className="text-muted-foreground">
                        Sign in to your account to continue
                    </CardDescription>
                </CardHeader>

                <CardContent>
                    <form onSubmit={handleLogin} className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoComplete="email"
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="password">Password</Label>
                            <div className="relative">
                                <Input
                                    id="password"
                                    type={showPassword ? "text" : "password"}
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    autoComplete="current-password"
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                    tabIndex={-1}
                                    aria-label={showPassword ? "Hide password" : "Show password"}
                                >
                                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                </button>
                            </div>
                        </div>

                        {justRegistered && (
                            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                                Account created! Please check your email to confirm, then sign in.
                            </p>
                        )}

                        {error && (
                            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                                {error}
                            </p>
                        )}

                        <Button type="submit" className="w-full mt-1" disabled={loading}>
                            {loading ? (
                                <>
                                    <Loader2 className="size-4 animate-spin" />
                                    Signing in...
                                </>
                            ) : (
                                "Sign In"
                            )}
                        </Button>

                        <p className="text-center text-sm text-muted-foreground">
                            Don&apos;t have an account?{" "}
                            <Link href="/register" className="font-medium text-primary hover:underline underline-offset-4">
                                Sign up
                            </Link>
                        </p>
                    </form>
                </CardContent>
            </Card>

            <p className="mt-6 text-sm text-muted-foreground">
                &copy; {new Date().getFullYear()} Crosshair Dinkers
            </p>
        </div>
    )
}
