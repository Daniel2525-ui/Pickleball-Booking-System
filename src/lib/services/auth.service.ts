import { createClient } from "@/lib/supabase/client"

type LoginResult =
    | { success: true; role: string }
    | { success: false; error: string }

export type RegisterResult =
    | { success: true }
    | { success: false; error: string }

/* Register */

export async function register(
    email: string,
    password: string,
    fullName: string,
    phone: string
): Promise<RegisterResult> {
    const supabase = createClient()

    try {
        const { error } = await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
                data: {
                    full_name: fullName.trim(),
                    phone: phone.trim(),
                },
            },
        })

        if (error) {
            return { success: false, error: error.message }
        }

        return { success: true }
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
    const supabase = createClient()

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
        })

        if (error || !data.user) {
            return {
                success: false,
                error: "Invalid email or password. Please try again.",
            }
        }

        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", data.user.id)
            .maybeSingle()

        if (profileError || !profile?.role) {
            return {
                success: false,
                error: "Unable to retrieve user profile.",
            }
        }

        return {
            success: true,
            role: profile.role,
        }
    } catch {
        return {
            success: false,
            error: "Something went wrong. Please try again.",
        }
    }
}

/* Logout */

export async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
}
