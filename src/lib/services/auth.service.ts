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
        const {
            data: authData,
            error: authError,
        } = await supabase.auth.signInWithPassword({
            email,
            password,
        })

        if (authError || !authData?.user) {
            return {
                success: false,
                error: "Invalid email or password. Please try again.",
            }
        }

        const user = authData.user

        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .maybeSingle()

        if (profileError) {
            return {
                success: false,
                error: "Unable to retrieve user profile.",
            }
        }

        let role = profile?.role

        if (!role) {
            // shortcut: self-heal missing profile row on client login, upgrade to database trigger on auth.users
            const meta = user.user_metadata || {}
            const { data: newProfile, error: insertError } = await supabase
                .from("profiles")
                .insert({
                    id: user.id,
                    email: user.email || email,
                    full_name: (meta.full_name as string) || (meta.name as string) || email.split("@")[0],
                    phone: (meta.phone as string) || "",
                    role: "customer",
                })
                .select("role")
                .single()

            if (insertError || !newProfile) {
                console.error("Failed to create missing user profile:", insertError)
                return {
                    success: false,
                    error: "Unable to retrieve user profile.",
                }
            }

            role = newProfile.role
        }

        return {
            success: true,
            role,
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