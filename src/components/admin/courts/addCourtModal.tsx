"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
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
}

export const AddCourtModal = ({ onCourtAdded }: AddCourtModalProps) => {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [status, setStatus] = useState("active");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) {
            setError("Court name is required");
            return;
        }

        setLoading(true);
        setError(null);

        const { error: submitError } = await addCourt(name, status);

        setLoading(false);

        if (submitError) {
            setError((submitError as any).message || "Failed to add court");
        } else {
            setOpen(false);
            setName("");
            setStatus("active");
            onCourtAdded();
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={
                <Button className="w-full sm:w-auto gap-2">
                    <Plus className="h-4 w-4" />
                    Add Court
                </Button>
            } />
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Add New Court</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-4">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="name">Court Name</Label>
                        <Input
                            id="name"
                            placeholder="e.g. Court 1"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="status">Status</Label>
                        <Select value={status} onValueChange={(value) => setStatus(value || "active")}>
                            <SelectTrigger id="status">
                                <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="active">Available</SelectItem>
                                <SelectItem value="maintenance">Maintenance</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {error && <p className="text-sm text-destructive">{error}</p>}

                    <DialogFooter className="mt-4">
                        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Court
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
