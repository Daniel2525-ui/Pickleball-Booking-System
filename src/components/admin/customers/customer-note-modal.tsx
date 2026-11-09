"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Customer } from "@/lib/services/customers/customersTypes";
import { saveCustomerNote } from "@/lib/services/customers/fetchCustomers.service";

/** Staff-only note on a member or walk-in, shown in this list and when the front desk picks the player. */
export const CustomerNoteModal = ({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: () => void }) => {
  const [note, setNote] = useState("");
  const [prev, setPrev] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (customer !== prev) {
    setPrev(customer);
    setNote(customer?.note ?? "");
    setError(null);
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) return;
    setSaving(true);
    const { error } = await saveCustomerNote(customer.id, note);
    setSaving(false);
    if (error) return setError(error.message);
    toast.success(note.trim() ? "Note saved." : "Note removed.");
    onClose();
    onSaved();
  };

  return (
    <Dialog open={!!customer} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Staff note</DialogTitle>
          <DialogDescription>
            Only staff see this note about {customer?.full_name?.trim() || "this customer"}. Leave it empty to remove it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="customer-note">Note</Label>
            <textarea
              id="customer-note"
              maxLength={300}
              rows={3}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setError(null);
              }}
              placeholder="e.g. VIP · Needs official receipt · Banned after 3 no-shows"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save note
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
