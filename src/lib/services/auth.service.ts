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

        let { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .maybeSingle()

        if (profileError) {
            console.error("Error fetching profile:", profileError)
        }

        // Fallback: If no profile row exists in public.profiles table, create it now or fallback to customer role
        if (!profile) {
            const { data: createdProfile } = await supabase
                .from("profiles")
                .insert({
                    id: user.id,
                    full_name: user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
                    email: user.email,
                    phone: user.user_metadata?.phone || user.phone || "",
                    role: "customer"
                })
                .select("role")
                .single()

            profile = createdProfile || { role: "customer" }
        }

        return {
            success: true,
            role: profile.role || "customer",
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