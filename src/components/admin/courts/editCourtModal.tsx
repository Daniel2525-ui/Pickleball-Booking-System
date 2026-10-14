"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
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

interface EditCourtModalProps {
    court: Court | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCourtUpdated: () => void;
}

export const EditCourtModal = ({ court, open, onOpenChange, onCourtUpdated }: EditCourtModalProps) => {
    const [name, setName] = useState("");
    const [status, setStatus] = useState("active");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (court) {
            setName(court.name);
            setStatus((court.status === "occupied" || court.status === "available") ? "active" : court.status);
            setError(null);
        }
    }, [court]);

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

        const { error: submitError } = await updateCourt(court.id, trimmedName, status);

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
