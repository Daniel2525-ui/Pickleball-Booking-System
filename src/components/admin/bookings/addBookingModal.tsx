"use client";

import { useState, useEffect } from "react";
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
import { createAdminBooking } from "@/lib/services/bookings/createAdminBooking.service";
import { fetchCourtsData } from "@/lib/services/courts/courtsData.service";
import { fetchCustomers } from "@/lib/services/customers/fetchCustomers.service";
import { Court } from "@/lib/services/courts/courtsTypes";
import { Customer } from "@/lib/services/customers/customersTypes";

interface AddBookingModalProps {
    onBookingAdded: () => void;
}

export const AddBookingModal = ({ onBookingAdded }: AddBookingModalProps) => {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [courts, setCourts] = useState<Court[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);

    const [userId, setUserId] = useState("");
    const [courtId, setCourtId] = useState("");
    const [date, setDate] = useState("");
    const [startTime, setStartTime] = useState("");
    const [endTime, setEndTime] = useState("");
    const [amount, setAmount] = useState("");

    useEffect(() => {
        if (open) {
            fetchCourtsData().then(res => setCourts(res.data || []));
            fetchCustomers().then(res => setCustomers(res.data || []));
        }
    }, [open]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!userId || !courtId || !date || !startTime || !endTime || !amount) {
            setError("All fields are required.");
            return;
        }

        setLoading(true);
        setError(null);

        const { error: submitError } = await createAdminBooking(
            userId,
            courtId,
            date,
            startTime,
            endTime,
            Number(amount)
        );

        setLoading(false);

        if (submitError) {
            setError((submitError as any).message || "Failed to create booking");
        } else {
            setOpen(false);
            setUserId("");
            setCourtId("");
            setDate("");
            setStartTime("");
            setEndTime("");
            setAmount("");
            onBookingAdded();
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={
                <Button className="w-full sm:w-auto gap-2">
                    <Plus className="h-4 w-4" />
                    New Booking
                </Button>
            } />
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Manual Booking</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-4">
                    <div className="flex flex-col gap-2">
                        <Label>Customer</Label>
                        <Select value={userId} onValueChange={(value) => setUserId(value as string)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select Customer" />
                            </SelectTrigger>
                            <SelectContent>
                                {customers.map(c => (
                                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label>Court</Label>
                        <Select value={courtId} onValueChange={(value) => setCourtId(value as string)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select Court" />
                            </SelectTrigger>
                            <SelectContent>
                                {courts.map(c => (
                                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label>Date</Label>
                        <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label>Start Time (24h)</Label>
                        <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label>End Time (24h)</Label>
                        <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label>Amount (PHP)</Label>
                        <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="1500" />
                    </div>

                    {error && <p className="text-sm text-destructive">{error}</p>}

                    <DialogFooter className="mt-4">
                        <Button type="submit" disabled={loading} className="w-full sm:w-auto">
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Creating...
                                </>
                            ) : (
                                "Create Booking"
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
