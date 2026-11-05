import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        const status = typeof body?.status === "string" ? body.status.trim() : "active";

        if (!name) {
            return NextResponse.json({ error: "Court name is required." }, { status: 400 });
        }

        const { data, error } = await supabase
            .from("courts")
            .insert([{ name, status }])
            .select()
            .single();

        if (error) {
            console.error("Failed to insert court:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ data });
    } catch (error) {
        console.error("Court creation route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        const id = typeof body?.id === "string" ? body.id.trim() : "";
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        const status = typeof body?.status === "string" ? body.status.trim() : "";

        if (!id || !name || !status) {
            return NextResponse.json({ error: "Court id, name, and status are required." }, { status: 400 });
        }

        // The note and return date only describe a maintenance closure; reopening a court clears them
        const note = status === "maintenance" && typeof body?.maintenance_note === "string" ? body.maintenance_note.trim() : "";
        const until = status === "maintenance" && typeof body?.maintenance_until === "string" ? body.maintenance_until.trim() : "";
        if (note.length > 120) {
            return NextResponse.json({ error: "Keep the maintenance reason under 120 characters." }, { status: 400 });
        }
        if (until && (!/^\d{4}-\d{2}-\d{2}$/.test(until) || Number.isNaN(Date.parse(until)))) {
            return NextResponse.json({ error: "The return date is not a valid date." }, { status: 400 });
        }

        const { data, error } = await supabase
            .from("courts")
            .update({ name, status, maintenance_note: note || null, maintenance_until: until || null })
            .eq("id", id)
            .select()
            .single();

        if (error) {
            console.error("Failed to update court:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ data });
    } catch (error) {
        console.error("Court update route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        const id = typeof body?.id === "string" ? body.id.trim() : "";

        if (!id) {
            return NextResponse.json({ error: "Court id is required." }, { status: 400 });
        }

        // Prevent deleting a court with existing bookings
        const { data: existingBookings, error: checkError } = await supabase
            .from("bookings")
            .select("id")
            .eq("court_id", id)
            .limit(1);

        if (checkError) {
            console.error("Failed to check court bookings:", checkError);
            return NextResponse.json({ error: "Failed to verify court usage." }, { status: 500 });
        }

        if (existingBookings && existingBookings.length > 0) {
            return NextResponse.json(
                {
                    error: "This court cannot be deleted because it has associated booking records. Please set its status to 'Maintenance' instead.",
                },
                { status: 409 }
            );
        }

        const { error } = await supabase.from("courts").delete().eq("id", id);
        if (error) {
            console.error("Failed to delete court:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Court deletion route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
