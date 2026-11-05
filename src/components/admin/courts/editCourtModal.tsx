"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Court } from "@/lib/services/courts/courtsTypes";
import { updateCourt } from "@/lib/services/courts/updateCourt.service";
import { CourtBooking, courtBookingName, fetchUpcomingCourtBookings } from "@/lib/services/courts/courtsData.service";
import { shortDate } from "@/lib/services/courts/courtDay";
import { getBookingDisplayStatus } from "@/lib/services/bookings/bookingDisplayStatus";
import { getBookingEnd } from "@/lib/utils/bookingTime";
import { formatTime12h } from "@/lib/utils/formatTime";

interface EditCourtModalProps {
    court: Court | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCourtUpdated: () => void;
}

export const EditCourtModal = ({ court, open, onOpenChange, onCourtUpdated }: EditCourtModalProps) => {
    const [name, setName] = useState(court?.name || "");
    const [status, setStatus] = useState(court ? ((court.status === "occupied" || court.status === "available") ? "active" : court.status) : "active");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState(court?.maintenance_note || "");
    const [until, setUntil] = useState(court?.maintenance_until || "");
    const [upcoming, setUpcoming] = useState<CourtBooking[]>([]);
    const [prevCourt, setPrevCourt] = useState<Court | null>(court);

    if (court !== prevCourt) {
        setPrevCourt(court);
        setName(court?.name || "");
        setStatus(court ? ((court.status === "occupied" || court.status === "available") ? "active" : court.status) : "active");
        setNote(court?.maintenance_note || "");
        setUntil(court?.maintenance_until || "");
        setUpcoming([]);
        setError(null);
    }

    // Closing a court leaves its bookings in place: list them so staff can contact or cancel those players
    const courtId = court?.id;
    useEffect(() => {
        if (status !== "maintenance" || !courtId) return;
        let ignore = false;
        fetchUpcomingCourtBookings(courtId).then(({ data }) => {
            const now = new Date();
            if (!ignore) setUpcoming(data.filter((b) => getBookingEnd(b) > now && getBookingDisplayStatus(b, now) !== "hold_expired"));
        });
        return () => {
            ignore = true;
        };
    }, [status, courtId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!court) return;

        const trimmedName = name.trim();
        if (!trimmedName) {
            setError("Please enter a court name.");
            return;
        }

        setLoading(true);
        setError(null);

        const { error: submitError } = await updateCourt(court.id, trimmedName, status, { note, until });

        setLoading(false);

        if (submitError) {
            const message = (submitError as Error)?.message || "Failed to update court. Please try again.";
            setError(message);
            toast.error(message);
        } else {
            toast.success(`Court "${trimmedName}" updated successfully.`);
            onOpenChange(false);
            onCourtUpdated();
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Edit Court</DialogTitle>
                    <DialogDescription>
                        Update court name and operational availability.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="edit-court-name">Court Name</Label>
                        <Input
                            id="edit-court-name"
                            placeholder="e.g. Court 1"
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                if (error) setError(null);
                            }}
                            autoFocus
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="edit-court-status">Operational Status</Label>
                        <Select value={status} onValueChange={(value) => setStatus(value as string)}>
                            <SelectTrigger id="edit-court-status">
                                <SelectValue placeholder="Select court status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="active">Available (Open for bookings)</SelectItem>
                                <SelectItem value="maintenance">Maintenance (Temporarily closed)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {status === "maintenance" && (
                        <>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="edit-court-note">Reason (optional)</Label>
                                <Input
                                    id="edit-court-note"
                                    placeholder="e.g. Net repair"
                                    maxLength={120}
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="edit-court-until">Back on (optional)</Label>
                                <Input id="edit-court-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
                            </div>
                        </>
                    )}

                    {status === "maintenance" && upcoming.length > 0 && (
                        <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                            <p className="flex items-center gap-1.5 font-semibold">
                                <AlertTriangle className="size-3.5 shrink-0" />
                                {upcoming.length} upcoming {upcoming.length === 1 ? "booking stays" : "bookings stay"} on this court
                            </p>
                            <p className="mt-1">Saving does not change them. Contact these players, or cancel their bookings from Bookings.</p>
                            <ul className="mt-2 max-h-36 space-y-1 overflow-auto">
                                {upcoming.map((b) => {
                                    const phone = b.customers?.phone || b.profiles?.phone;
                                    return (
                                        <li key={b.id}>
                                            <span className="font-semibold">{courtBookingName(b)}</span> · {shortDate(b.booking_date)} · {formatTime12h(b.start_time)}
                                            {phone && (
                                                <>
                                                    {" · "}
                                                    <a href={`tel:${phone}`} className="underline underline-offset-2">{phone}</a>
                                                </>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                            <Link href={`/admin/bookings?court=${court?.id}`} className="mt-2 inline-block font-semibold underline underline-offset-2">
                                Open these in Bookings
                            </Link>
                        </div>
                    )}

                    {error && (
                        <p className="text-sm font-medium text-destructive">{error}</p>
                    )}

                    <DialogFooter className="mt-4">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={loading}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving Changes...
                                </>
                            ) : (
                                "Save Changes"
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};
