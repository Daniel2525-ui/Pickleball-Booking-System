import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";
import { formatManilaDate } from "@/lib/utils/bookingTime";

export async function GET(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const searchParams = request.nextUrl.searchParams;
        const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "100", 10) || 100), 500);
        const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10) || 0);
        const search = searchParams.get("search")?.replace(/[(),%]/g, " ").trim() || "";

        // Members and walk-in records with their history, staff accounts left out (customer_directory view)
        // shortcut: the view totals every customer's bookings per request; fine at venue scale, add a stats table if it slows down
        let listQuery = supabase
            .from("customer_directory")
            .select("*", { count: "exact" })
            .order("created_at", { ascending: false })
            .order("id")
            .range(offset, offset + limit - 1);
        if (search) {
            listQuery = listQuery.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%,note.ilike.%${search}%`);
        }

        // "New this month" in venue time
        const monthStart = new Date(`${formatManilaDate().slice(0, 7)}-01T00:00:00+08:00`).toISOString();
        const [list, newThisMonth] = await Promise.all([
            listQuery,
            supabase.from("customer_directory").select("id", { count: "exact", head: true }).gte("created_at", monthStart),
        ]);

        if (list.error || newThisMonth.error) {
            console.error("Failed to load customers:", list.error || newThisMonth.error);
            return NextResponse.json({ error: (list.error || newThisMonth.error)?.message }, { status: 500 });
        }

        return NextResponse.json({ data: list.data ?? [], total: list.count ?? 0, newThisMonth: newThisMonth.count ?? 0 });
    } catch (error) {
        console.error("Fetch customers route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
        const phone = typeof body?.phone === "string" ? body.phone.trim() || null : null;
        const email = typeof body?.email === "string" ? body.email.trim() || null : null;

        if (!fullName) {
            return NextResponse.json({ error: "Full name is required for walk-in customer." }, { status: 400 });
        }

        const { data, error } = await supabase
            .from("customers")
            .insert({
                full_name: fullName,
                phone,
                email,
            })
            .select()
            .single();

        if (error) {
            console.error("Failed to insert customer:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ data });
    } catch (error) {
        console.error("Create customer route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

/** Corrects a walk-in record's details. Members keep their own profile, so only walk-in records are editable here. */
export async function PATCH(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        const id = typeof body?.id === "string" ? body.id.trim() : "";
        const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
        const phone = typeof body?.phone === "string" ? body.phone.trim() || null : null;
        const email = typeof body?.email === "string" ? body.email.trim() || null : null;

        if (!id || !fullName) {
            return NextResponse.json({ error: "A name is required." }, { status: 400 });
        }
        if (fullName.length > 100 || (phone && phone.length > 20) || (email && email.length > 254)) {
            return NextResponse.json({ error: "One of the details is too long." }, { status: 400 });
        }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return NextResponse.json({ error: "Enter a valid email address, or leave it blank." }, { status: 400 });
        }

        const { data, error } = await supabase
            .from("customers")
            .update({ full_name: fullName, phone, email })
            .eq("id", id)
            .select()
            .maybeSingle();

        if (error) {
            console.error("Failed to update customer:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        if (!data) return NextResponse.json({ error: "Walk-in record not found." }, { status: 404 });

        return NextResponse.json({ data });
    } catch (error) {
        console.error("Update customer route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

/** Sets or clears the staff note on a member or walk-in (id from customer_directory). An empty note removes it. */
export async function PUT(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        const id = typeof body?.id === "string" ? body.id.trim() : "";
        const note = typeof body?.note === "string" ? body.note.trim() : "";

        if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Customer not found." }, { status: 400 });
        if (note.length > 300) return NextResponse.json({ error: "Keep the note to 300 characters." }, { status: 400 });

        const { error } = note
            ? await supabase.from("customer_notes").upsert({ person_id: id, note, updated_at: new Date().toISOString() })
            : await supabase.from("customer_notes").delete().eq("person_id", id);

        if (error) {
            console.error("Failed to save customer note:", error);
            return NextResponse.json({ error: "Could not save the note." }, { status: 500 });
        }

        return NextResponse.json({ note: note || null });
    } catch (error) {
        console.error("Customer note route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
