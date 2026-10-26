"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Clock, LoaderCircle, RefreshCw, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { calculateRemainingSeconds, formatCountdown } from "@/lib/utils/countdown";
import { fetchBookingStatus } from "@/lib/services/bookings/fetchBookingStatus.service";

interface BookingCountdownProps {
    bookingId: string;
    holdExpiresAt?: string | null;
    status: string;
    onStatusChange?: (newStatus: string) => void;
    variant?: "badge" | "callout" | "dialog";
    className?: string;
}

export const BookingCountdown = ({
    bookingId,
    holdExpiresAt,
    status,
    onStatusChange,
    variant = "badge",
    className = "",
}: BookingCountdownProps) => {
    const isPending = (status || "").toLowerCase() === "pending";
    const [now, setNow] = useState<number>(() => Date.now());
    const [isChecking, setIsChecking] = useState(false);
    const [checkError, setCheckError] = useState<string | null>(null);
    const checkingInFlight = useRef(false);

    // Derived countdown from server-provided timestamp and tick time
    const secondsRemaining = isPending && holdExpiresAt
        ? calculateRemainingSeconds(holdExpiresAt, now)
        : 0;

    const checkAuthoritativeStatus = useCallback(async () => {
        if (checkingInFlight.current || !bookingId) return;
        checkingInFlight.current = true;
        setIsChecking(true);
        setCheckError(null);

        try {
            const { data, error } = await fetchBookingStatus(bookingId);
            if (error || !data) {
                setCheckError("Could not verify status.");
                return;
            }

            const authoritativeStatus = (data.status || "").toLowerCase();
            if (authoritativeStatus !== "pending") {
                onStatusChange?.(authoritativeStatus);
            }
        } finally {
            setIsChecking(false);
            checkingInFlight.current = false;
        }
    }, [bookingId, onStatusChange]);

    // 1-second ticker while booking is pending and unexpired
    useEffect(() => {
        if (!isPending || !holdExpiresAt || secondsRemaining <= 0) {
            return;
        }

        const timer = setInterval(() => {
            setNow(Date.now());
        }, 1000);

        return () => {
            clearInterval(timer);
        };
    }, [isPending, holdExpiresAt, secondsRemaining]);

    // Authoritative check on expiry
    const hasTriggeredCheckOnExpiry = useRef(false);
    useEffect(() => {
        if (!isPending || !holdExpiresAt) return;

        if (secondsRemaining <= 0 && !hasTriggeredCheckOnExpiry.current) {
            hasTriggeredCheckOnExpiry.current = true;
            checkAuthoritativeStatus();
        }
    }, [isPending, holdExpiresAt, secondsRemaining, checkAuthoritativeStatus]);

    if (!isPending) {
        return null;
    }

    const formattedTime = formatCountdown(secondsRemaining);

    // Variant 1: Dialog callout (for booking grid modal)
    if (variant === "dialog") {
        return (
            <div
                className={`flex items-center justify-between p-3 rounded-xl border bg-amber-500/10 border-amber-500/25 text-amber-900 dark:text-amber-200 text-xs ${className}`}
            >
                <div className="flex items-center gap-2">
                    {isChecking ? (
                        <LoaderCircle className="size-4 animate-spin text-amber-600 dark:text-amber-400 shrink-0" />
                    ) : (
                        <Clock className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    )}
                    <span>
                        {isChecking ? (
                            "Checking payment status with server..."
                        ) : secondsRemaining > 0 ? (
                            <>
                                Hold expires in{" "}
                                <span className="font-mono font-bold text-foreground">
                                    {formattedTime}
                                </span>
                            </>
                        ) : (
                            "Hold time elapsed"
                        )}
                    </span>
                </div>
                {secondsRemaining <= 0 && !isChecking && (
                    <button
                        type="button"
                        onClick={checkAuthoritativeStatus}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline ml-2 shrink-0"
                    >
                        <RefreshCw className="size-3" />
                        Refresh
                    </button>
                )}
            </div>
        );
    }

    // Variant 2: Prominent Callout (for book/success incomplete state)
    if (variant === "callout") {
        return (
            <div
                className={`rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 space-y-2 text-xs sm:text-sm text-amber-900 dark:text-amber-200 ${className}`}
            >
                <div className="flex items-center justify-between font-bold">
                    <div className="flex items-center gap-2">
                        {isChecking ? (
                            <LoaderCircle className="size-4 animate-spin text-amber-600 dark:text-amber-400 shrink-0" />
                        ) : (
                            <Clock className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
                        )}
                        <span>Court Hold In Progress</span>
                    </div>
                    {secondsRemaining > 0 ? (
                        <span className="font-mono text-base font-extrabold text-amber-700 dark:text-amber-400">
                            {formattedTime}
                        </span>
                    ) : (
                        <span className="text-xs font-semibold text-muted-foreground">Elapsed</span>
                    )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                    {isChecking
                        ? "Verifying payment with payment provider..."
                        : secondsRemaining > 0
                        ? "This court is temporarily reserved for your checkout. Complete payment before the countdown expires to guarantee your slot."
                        : "Your hold duration has elapsed. If you already completed payment, please check your reservation status."}
                </p>
                {secondsRemaining <= 0 && !isChecking && (
                    <div className="pt-1 flex items-center justify-between">
                        {checkError && (
                            <span className="text-[11px] text-destructive flex items-center gap-1">
                                <AlertCircle className="size-3" />
                                {checkError}
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={checkAuthoritativeStatus}
                            className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline ml-auto"
                        >
                            <RefreshCw className="size-3.5" />
                            Re-check Status
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // Default Variant: Badge (for My Bookings cards)
    return (
        <Badge
            variant="outline"
            className={`bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-semibold text-xs gap-1.5 transition-all ${className}`}
        >
            {isChecking ? (
                <LoaderCircle className="size-3 animate-spin text-amber-600 dark:text-amber-400" />
            ) : (
                <Clock className="size-3 text-amber-600 dark:text-amber-400" />
            )}
            <span>PENDING PAYMENT</span>
            {isChecking ? (
                <span className="text-[10px] font-normal text-muted-foreground">
                    • checking...
                </span>
            ) : secondsRemaining > 0 ? (
                <span className="font-mono font-bold text-foreground">
                    • {formattedTime}
                </span>
            ) : (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        checkAuthoritativeStatus();
                    }}
                    className="inline-flex items-center gap-0.5 text-[10px] font-bold text-primary hover:underline ml-0.5"
                    title="Check latest status"
                >
                    • expired (refresh)
                </button>
            )}
        </Badge>
    );
};
