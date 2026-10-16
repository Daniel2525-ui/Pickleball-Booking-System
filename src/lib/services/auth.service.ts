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
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
                data: { full_name: fullName.trim(), phone },
            },
        })

        if (signUpError) {
            return {
                success: false,
                error: signUpError.message,
            }
        }

        if (signUpData?.user?.id) {
            // shortcut: pre-seed profile row on registration, upgrade to database trigger on auth.users
            try {
                await supabase.from("profiles").insert({
                    id: signUpData.user.id,
                    email: email.trim(),
                    full_name: fullName.trim(),
                    phone,
                    role: "customer",
                })
            } catch {
                // Unconfirmed session may prevent client insert; self-heals upon first login
            }
        }

        return { success: true }
    } catch {
        return {
            success: false,
            error: "Unable to complete registration. Please check your connection and try again.",
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