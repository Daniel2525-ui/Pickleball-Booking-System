"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
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
        }
    }, [court]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!court) return;

        if (!name.trim()) {
            setError("Court name is required");
            return;
        }

        setLoading(true);
        setError(null);

        const { error: submitError } = await updateCourt(court.id, name, status);

        setLoading(false);

        if (submitError) {
            setError((submitError as any).message || "Failed to update court");
        } else {
            onOpenChange(false);
            onCourtUpdated();
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Edit Court</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-4">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="edit-name">Court Name</Label>
                        <Input
                            id="edit-name"
                            placeholder="e.g. Court 1"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="edit-status">Status</Label>
                        <Select value={status} onValueChange={(value) => setStatus(value as string)}>
                            <SelectTrigger id="edit-status">
                                <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="available">Available</SelectItem>
                                <SelectItem value="maintenance">Maintenance</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {error && <p className="text-sm text-destructive">{error}</p>}

                    <DialogFooter className="mt-4">
                        <Button type="submit" disabled={loading} className="w-full sm:w-auto">
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving...
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
}
