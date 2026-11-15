import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";

/** Sets or clears the staff note on a booking. An empty note removes it. */
export async function PUT(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        const id = typeof body?.id === "string" ? body.id.trim() : "";
        const note = typeof body?.note === "string" ? body.note.trim() : "";

        if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Booking not found." }, { status: 400 });
        if (note.length > 300) return NextResponse.json({ error: "Keep the note to 300 characters." }, { status: 400 });

        const { error } = note
            ? await supabase.from("booking_notes").upsert({ booking_id: id, note, updated_at: new Date().toISOString() })
            : await supabase.from("booking_notes").delete().eq("booking_id", id);

        if (error) {
            console.error("Failed to save booking note:", error);
            // booking_notes_booking_id_fkey: the booking no longer exists
            if (error.code === "23503") return NextResponse.json({ error: "Booking not found." }, { status: 404 });
            return NextResponse.json({ error: "Could not save the note." }, { status: 500 });
        }

        return NextResponse.json({ note: note || null });
    } catch (error) {
        console.error("Booking note route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
