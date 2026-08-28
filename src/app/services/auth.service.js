import { createClient } from "@/lib/supabase/client"

export default async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
}
