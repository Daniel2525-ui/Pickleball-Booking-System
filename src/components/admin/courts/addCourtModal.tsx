"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
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
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { addCourt } from "@/lib/services/courts/addCourt.service";

interface AddCourtModalProps {
    onCourtAdded: () => void;
    trigger?: React.ReactElement;
}

export const AddCourtModal = ({ onCourtAdded, trigger }: AddCourtModalProps) => {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [status, setStatus] = useState("active");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) {
            setError("Please enter a court name.");
            return;
        }

        setLoading(true);
        setError(null);

        const { error: submitError } = await addCourt(trimmedName, status);

        setLoading(false);

        if (submitError) {
            const message = (submitError as Error)?.message || "Failed to add court. Please try again.";
            setError(message);
            toast.error(message);
        } else {
            toast.success(`Court "${trimmedName}" added successfully.`);
            setOpen(false);
            setName("");
            setStatus("active");
            onCourtAdded();
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger 
                render={trigger || (
                    <Button className="w-full sm:w-auto gap-2">
                        <Plus className="h-4 w-4" />
                        Add Court
                    </Button>
                )} 
            />
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Add New Court</DialogTitle>
                    <DialogDescription>
                        Add a new pickleball court to your venue for player reservations.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="court-name">Court Name</Label>
                        <Input
                            id="court-name"
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
                        <Label htmlFor="court-status">Initial Status</Label>
                        <Select value={status} onValueChange={(value) => setStatus(value || "active")}>
                            <SelectTrigger id="court-status">
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
                            onClick={() => setOpen(false)}
                            disabled={loading}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Adding Court...
                                </>
                            ) : (
                                "Add Court"
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};
