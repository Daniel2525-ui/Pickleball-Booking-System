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
import { COURT_STATUS_LABELS, Court } from "@/lib/services/courts/courtsTypes";
import { updateCourt } from "@/lib/services/courts/updateCourt.service";
import { CourtBooking, courtBookingName, fetchUpcomingCourtBookings } from "@/lib/services/courts/courtsData.service";
import { getBookingDisplayStatus } from "@/lib/services/bookings/bookingDisplayStatus";
import { getBookingEnd } from "@/lib/utils/bookingTime";
import { formatTime12h, formatShortDate } from "@/lib/utils/formatTime";
import { supabase } from "@/lib/supabase";
import { COURT_PHOTO_BUCKET } from "@/lib/services/courts/courtPhoto";

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // the court-photos bucket refuses anything larger

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
    const [details, setDetails] = useState(court?.details || "");
    // The saved photo (null once removed), and a picked file waiting for Save
    const [photoUrl, setPhotoUrl] = useState<string | null>(court?.photo_url ?? null);
    const [pendingPhoto, setPendingPhoto] = useState<{ file: File; preview: string } | null>(null);
    const [photoError, setPhotoError] = useState<string | null>(null);
    const [prevCourt, setPrevCourt] = useState<Court | null>(court);

    if (court !== prevCourt) {
        setPrevCourt(court);
        setName(court?.name || "");
        setStatus(court ? ((court.status === "occupied" || court.status === "available") ? "active" : court.status) : "active");
        setNote(court?.maintenance_note || "");
        setUntil(court?.maintenance_until || "");
        setUpcoming([]);
        setDetails(court?.details || "");
        setPhotoUrl(court?.photo_url ?? null);
        setPendingPhoto(null);
        setPhotoError(null);
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

        let nextPhotoUrl = photoUrl;
        if (pendingPhoto) {
            const ext = pendingPhoto.file.type.split("/")[1] === "jpeg" ? "jpg" : pendingPhoto.file.type.split("/")[1];
            const path = `${court.id}-${Date.now()}.${ext}`;
            const { error: uploadError } = await supabase.storage.from(COURT_PHOTO_BUCKET).upload(path, pendingPhoto.file, { contentType: pendingPhoto.file.type });
            if (uploadError) {
                setLoading(false);
                setPhotoError(`The photo could not be uploaded: ${uploadError.message}`);
                return;
            }
            nextPhotoUrl = supabase.storage.from(COURT_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
        }
        const { error: submitError } = await updateCourt(court.id, trimmedName, status, { note, until }, { photo_url: nextPhotoUrl, details });
        // The replaced or removed file is no longer used; leaving it behind only costs storage, so this is best effort
        const oldPath = court.photo_url?.split(`/${COURT_PHOTO_BUCKET}/`)[1];
        if (!submitError && oldPath && court.photo_url !== nextPhotoUrl) {
            await supabase.storage.from(COURT_PHOTO_BUCKET).remove([decodeURIComponent(oldPath)]);
        }

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
            <DialogContent className="sm:max-w-[425px] max-h-[90dvh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Edit Court</DialogTitle>
                    <DialogDescription>
                        Update the court name, availability, and how it appears on the home page.
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
                            <SelectTrigger id="edit-court-status" className="h-10 w-full">
                                <SelectValue placeholder="Select court status">{(value) => COURT_STATUS_LABELS[value as string] ?? value}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {Object.entries(COURT_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value} className="py-2.5">{label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="edit-court-photo">Court photo</Label>
                        {(pendingPhoto?.preview || photoUrl) && (
                            // eslint-disable-next-line @next/next/no-img-element -- a local blob preview or a Supabase public URL
                            <img
                                src={pendingPhoto?.preview || photoUrl || ""}
                                alt="Photo preview"
                                className="aspect-[16/10] w-full rounded-lg border object-cover"
                            />
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                            <Input
                                id="edit-court-photo"
                                type="file"
                                accept={PHOTO_TYPES.join(",")}
                                className="min-w-0 flex-1"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = "";
                                    if (!file) return;
                                    if (!PHOTO_TYPES.includes(file.type)) return setPhotoError("Use a JPG, PNG or WebP image.");
                                    if (file.size > PHOTO_MAX_BYTES) return setPhotoError("The photo must be 5 MB or smaller.");
                                    setPhotoError(null);
                                    setPendingPhoto({ file, preview: URL.createObjectURL(file) });
                                }}
                            />
                            {(pendingPhoto || photoUrl) && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setPendingPhoto(null);
                                        setPhotoUrl(null);
                                    }}
                                >
                                    Remove photo
                                </Button>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">Shown on the home page. JPG, PNG or WebP, up to 5 MB. Without one, a drawn court is shown.</p>
                        {photoError && <p role="alert" className="text-xs font-medium text-destructive">{photoError}</p>}
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="edit-court-details">Details (optional)</Label>
                        <Input
                            id="edit-court-details"
                            placeholder="e.g. Covered · LED lights · Spectator bench"
                            maxLength={80}
                            value={details}
                            onChange={(e) => setDetails(e.target.value)}
                        />
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
                                            <span className="font-semibold">{courtBookingName(b)}</span> · {formatShortDate(b.booking_date)} · {formatTime12h(b.start_time)}
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
