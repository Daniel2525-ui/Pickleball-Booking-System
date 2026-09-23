import React from "react";
import { Clock, CheckCircle, MapPin, Calendar, LoaderCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
} from "@/components/ui/dialog";
import { Slot } from "./types";

interface BookingModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selectedSlot: Slot | null;
  isBookingSuccess: boolean;
  isLoading?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCloseAndReset: () => void;
}

export function BookingModal({
  isOpen,
  onOpenChange,
  selectedSlot,
  isBookingSuccess,
  isLoading,
  error,
  onConfirm,
  onCloseAndReset,
}: BookingModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {!isBookingSuccess ? (
          <>
            <DialogHeader>
              <DialogTitle>Confirm Reservation</DialogTitle>
              <DialogDescription>
                Review your booking details before proceeding to payment.
              </DialogDescription>
            </DialogHeader>
            
            {selectedSlot && (
              <div className="bg-muted p-4 rounded-xl my-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{selectedSlot.court}</p>
                    <div className="flex items-center text-sm text-muted-foreground mt-1 gap-1">
                      <Calendar className="size-3.5" />
                      {selectedSlot.date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                    </div>
                    <div className="flex items-center text-sm text-muted-foreground mt-1 gap-1">
                      <Clock className="size-3.5" />
                      {selectedSlot.time}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold">₱{selectedSlot.price.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Total due</p>
                  </div>
                </div>
                
                <div className="pt-3 border-t flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="size-4" />
                  123 Pickleball Ave, Butuan City
                </div>
              </div>
            )}

            {error && (
              <div className="bg-destructive/15 text-destructive text-sm p-3 rounded-md flex items-start gap-2 mb-4">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0 mt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto" disabled={isLoading}>
                Cancel
              </Button>
              <Button onClick={onConfirm} className="w-full sm:w-auto gap-2" disabled={isLoading}>
                {isLoading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <CheckCircle className="size-4" />
                )}
                {isLoading ? "Redirecting..." : "Confirm & Pay"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="py-8 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="size-8" />
            </div>
            <DialogTitle className="text-xl mb-2">Booking Confirmed!</DialogTitle>
            <DialogDescription className="text-base mb-6">
              Your court has been successfully reserved. We've sent the details to your email.
            </DialogDescription>
            <Button 
              className="w-full" 
              onClick={onCloseAndReset}
            >
              View My Bookings
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
