import { createClient } from "@/lib/supabase/client"

type LoginResult =
    | { success: true; role: string }
    | { success: false; error: string; unconfirmed?: boolean }

export type RegisterResult =
    | { success: true; signedIn?: boolean }
    | { success: false; error: string }

// Sign-up, sign-in and reset requests go through /api/auth/* so they are rate limited server-side
async function postAuth(path: string, body: Record<string, string>) {
    const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    return { ok: res.ok, data }
}

/* Register */

export async function register(
    email: string,
    password: string,
    fullName: string,
    phone: string
): Promise<RegisterResult> {
    try {
        const { ok, data } = await postAuth("/api/auth/register", { email, password, fullName, phone })
        return ok ? { success: true, signedIn: !!data?.signedIn } : { success: false, error: data?.error || "Unable to complete registration. Please try again." }
    } catch {
        return {
            success: false,
            error: "Unable to complete registration. Please try again.",
        }
    }
}

/* Login */

export async function login(
    email: string,
    password: string
): Promise<LoginResult> {
    try {
        const { ok, data } = await postAuth("/api/auth/login", { email, password })
        if (!ok || !data?.role) {
            return {
                success: false,
                error: data?.error || "Invalid email or password. Please try again.",
                unconfirmed: data?.code === "email_not_confirmed",
            }
        }
        return { success: true, role: data.role }
    } catch {
        return {
            success: false,
            error: "Something went wrong. Please try again.",
        }
    }
}

/* Sign-up confirmation email, sent again */

export async function resendConfirmation(email: string): Promise<RegisterResult> {
    try {
        const { ok, data } = await postAuth("/api/auth/resend-confirmation", { email })
        return ok ? { success: true } : { success: false, error: data?.error || "Unable to send the confirmation email. Please try again." }
    } catch {
        return { success: false, error: "Unable to send the confirmation email. Please try again." }
    }
}

/* Password reset */

export async function requestPasswordReset(email: string): Promise<RegisterResult> {
    try {
        const { ok, data } = await postAuth("/api/auth/forgot-password", { email })
        return ok ? { success: true } : { success: false, error: data?.error || "Unable to send the reset email. Please try again." }
    } catch {
        return { success: false, error: "Unable to send the reset email. Please try again." }
    }
}

/** Requires the recovery session created when the user opens the emailed reset link. */
export async function updatePassword(password: string): Promise<RegisterResult> {
    const supabase = createClient()

    try {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) {
            return { success: false, error: error.message }
        }
        return { success: true }
    } catch {
        return { success: false, error: "Unable to update your password. Please try again." }
    }
}

/* Logout */

export async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
}
