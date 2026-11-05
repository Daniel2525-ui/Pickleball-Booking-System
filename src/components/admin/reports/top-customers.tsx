import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatShortDate } from "@/lib/utils/formatTime";
import type { VenueReport } from "@/lib/services/reports/reports";
import { peso } from "./revenue-chart";

/** The period's top players by money spent. Phones show only the player, visits and spent. */
export function TopCustomers({ customers }: { customers: VenueReport["top_customers"] }) {
  if (customers.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No customers in this period.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-10">#</TableHead>
          <TableHead>Player</TableHead>
          <TableHead className="text-right">Visits</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Hours</TableHead>
          <TableHead className="text-right">Spent</TableHead>
          <TableHead className="hidden sm:table-cell">Last visit</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map((c, i) => (
          <TableRow key={`${c.name}-${i}`}>
            <TableCell className="text-muted-foreground">{i + 1}</TableCell>
            <TableCell className="font-semibold">{c.name}</TableCell>
            <TableCell className="text-right">{c.visits}</TableCell>
            <TableCell className="hidden text-right sm:table-cell">{c.hours}</TableCell>
            <TableCell className="text-right font-semibold">{peso(c.spent)}</TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">{c.last_visit ? formatShortDate(c.last_visit) : "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
