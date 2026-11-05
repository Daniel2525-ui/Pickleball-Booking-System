"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Customer } from "@/lib/services/customers/customersTypes";
import { updateWalkInCustomer } from "@/lib/services/customers/fetchCustomers.service";

/** Fixes a walk-in record's details (members edit their own profile). */
export const EditCustomerModal = ({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: () => void }) => {
  const [fields, setFields] = useState({ fullName: "", phone: "", email: "" });
  const [prev, setPrev] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (customer !== prev) {
    setPrev(customer);
    setFields({ fullName: customer?.full_name ?? "", phone: customer?.phone ?? "", email: customer?.email ?? "" });
    setError(null);
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) return;
    if (!fields.fullName.trim()) return setError("Please enter a name.");
    setSaving(true);
    const { error } = await updateWalkInCustomer(customer.id, fields);
    setSaving(false);
    if (error) return setError(error.message);
    toast.success("Customer details updated.");
    onClose();
    onSaved();
  };

  const field = (id: keyof typeof fields, label: string, type = "text") => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`edit-customer-${id}`}>{label}</Label>
      <Input
        id={`edit-customer-${id}`}
        type={type}
        value={fields[id]}
        onChange={(e) => {
          setFields((f) => ({ ...f, [id]: e.target.value }));
          setError(null);
        }}
      />
    </div>
  );

  return (
    <Dialog open={!!customer} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Walk-in Customer</DialogTitle>
          <DialogDescription>Correct the details recorded at the desk. Their bookings keep the name they were made under.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-4 py-2">
          {field("fullName", "Full name")}
          {field("phone", "Mobile number", "tel")}
          {field("email", "Email (optional)", "email")}
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
