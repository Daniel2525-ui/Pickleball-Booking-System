import { createClient } from "@/lib/supabase/client"

type LoginResult =
    | { success: true; role: string }
    | { success: false; error: string }

/* Login */

export async function login(
    email: string,
    password: string
): Promise<LoginResult> {
    const supabase = createClient()

    try {
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        })

        if (error) {
            return {
                success: false,
                error: "Invalid email or password. Please try again.",
            }
        }

        const {
            data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
            return {
                success: false,
                error: "Unable to retrieve user information.",
            }
        }

        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .single()

        if (profileError) {
            return {
                success: false,
                error: "Unable to retrieve your profile.",
            }
        }

        return {
            success: true,
            role: profile.role,
        }
    } catch (error) {
        console.error("Login error:", error)

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