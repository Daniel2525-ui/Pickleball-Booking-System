import { Customer } from "@/lib/services/customers/customersTypes";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Link from "next/link";
import { formatDate } from "@/lib/utils/formatTime";
import { Users, SearchX, Mail, Phone, MoreHorizontal, Pencil, CalendarSearch, StickyNote } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// The Bookings search matches phone endings and names, across every date
const bookingsHref = (c: Customer) =>
  `/admin/bookings?search=${encodeURIComponent(c.phone?.trim() || c.full_name.trim())}`;

const peso = (n: number) => `₱${Number(n || 0).toLocaleString("en-PH")}`;

interface CustomersTableProps {
  customers: Customer[];
  loading?: boolean;
  searchQuery?: string;
  onEdit?: (customer: Customer) => void;
  onNote?: (customer: Customer) => void;
}

/** The staff note, in the same amber as the repeat no-show count */
export const CustomerNote = ({ note }: { note: string }) => (
  <span className="flex items-start gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300 whitespace-pre-line break-words">
    <StickyNote aria-hidden className="mt-0.5 size-3 shrink-0" />
    <span><span className="sr-only">Staff note: </span>{note}</span>
  </span>
);

const getInitials = (name?: string) => {
  if (!name || !name.trim()) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export const CustomersTable = ({
  customers,
  loading,
  searchQuery,
  onEdit,
  onNote,
}: CustomersTableProps) => {
  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      <div className="overflow-y-auto max-h-[500px]">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10 border-b">
            <TableRow className="hover:bg-transparent">
              <TableHead className="bg-card w-[320px]">Customer</TableHead>
              <TableHead className="bg-card">Contact</TableHead>
              <TableHead className="text-right bg-card">Bookings</TableHead>
              <TableHead className="bg-card">Last visit</TableHead>
              <TableHead className="text-right bg-card">No-shows</TableHead>
              <TableHead className="text-right bg-card">Spent</TableHead>
              <TableHead className="bg-card">Added</TableHead>
              <TableHead className="bg-card"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="h-4 w-24 ml-auto" />
                  </TableCell>
                  <TableCell colSpan={5} />
                </TableRow>
              ))
            ) : customers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-64 text-center">
                  <div className="flex flex-col items-center justify-center space-y-3 max-w-sm mx-auto py-6">
                    <div className="rounded-full bg-muted p-3">
                      {searchQuery ? (
                        <SearchX className="h-6 w-6 text-muted-foreground" />
                      ) : (
                        <Users className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="text-base font-semibold">
                      {searchQuery ? "No matching customers found" : "No registered customers yet"}
                    </div>
                    <p className="text-sm text-muted-foreground text-center">
                      {searchQuery
                        ? `We couldn't find any customers matching "${searchQuery}". Check the spelling or adjust your search.`
                        : "Customer records will appear here as soon as players create an account or book a court."}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary select-none">
                        {getInitials(customer.full_name)}
                      </div>
                      <div className="flex flex-col items-start gap-1 min-w-0">
                        <span className="font-medium text-foreground truncate">
                          {customer.full_name?.trim() || "Unnamed Customer"}
                        </span>
                        <Badge variant="outline" className="text-[10px] font-semibold">
                          {customer.type === "registered" ? "Member" : "Walk-in"}
                        </Badge>
                        {customer.note && <CustomerNote note={customer.note} />}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 text-sm text-foreground">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">{customer.email?.trim() || "No email provided"}</span>
                      </div>
                      {customer.phone?.trim() ? (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3 shrink-0" />
                          <a href={`tel:${customer.phone.trim()}`} className="hover:text-foreground hover:underline underline-offset-2">
                            {customer.phone.trim()}
                          </a>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/60 italic">
                          No phone provided
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{customer.bookings_count}</TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDate(customer.last_visit)}
                  </TableCell>
                  <TableCell className="text-right">
                    {customer.no_shows >= 2 ? (
                      <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-800 dark:text-amber-300">{customer.no_shows}</span>
                    ) : (
                      customer.no_shows
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">{peso(customer.total_spent)}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap text-sm font-medium">
                    {formatDate(customer.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <button
                            type="button"
                            aria-label={`Actions for ${customer.full_name}`}
                            className="inline-flex items-center justify-center rounded-lg h-8 w-8 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        }
                      >
                        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem render={<Link href={bookingsHref(customer)} />} className="cursor-pointer text-xs font-semibold">
                          <CalendarSearch className="mr-2 h-4 w-4" />
                          View bookings
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onNote?.(customer)} className="cursor-pointer text-xs font-semibold">
                          <StickyNote className="mr-2 h-4 w-4" />
                          {customer.note ? "Edit note" : "Add note"}
                        </DropdownMenuItem>
                        {customer.type === "walk_in" && (
                          <DropdownMenuItem onClick={() => onEdit?.(customer)} className="cursor-pointer text-xs font-semibold">
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit details
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
