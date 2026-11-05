"use client";

import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTime12h, formatShortDate } from "@/lib/utils/formatTime";
import { type OpenPlayAdminSession } from "./open-play-container";

export interface PastSession extends OpenPlayAdminSession {
  played: number;
  collected: number;
}


/** The last 28 days of sessions: how full they were, who played, and the money still held. */
export function PastSessionsTable({ sessions, loading, onPlayers }: { sessions: PastSession[]; loading: boolean; onPlayers: (s: OpenPlayAdminSession) => void }) {
  return (
    <Card className="border border-border shadow-2xs">
      <CardHeader>
        <CardTitle className="text-base font-bold">Past sessions (last 28 days)</CardTitle>
        <p className="text-xs text-muted-foreground">
          Money held counts payments still in hand: kept payments, and refunds owed until they are refunded.
        </p>
      </CardHeader>
      {/* Edge-to-edge table: its cell padding lines the text up with the card title */}
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
              <TableHead className="text-right">Booked</TableHead>
              <TableHead className="text-right">Played</TableHead>
              <TableHead className="text-right">Money held</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
            ) : sessions.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No open play sessions in the last 28 days.</TableCell></TableRow>
            ) : (
              sessions.map((s) => (
                <TableRow key={s.id} className={s.status === "cancelled" ? "opacity-60" : ""}>
                  <TableCell className="font-semibold">{formatShortDate(s.session_date)}</TableCell>
                  <TableCell>{formatTime12h(s.start_time)} – {formatTime12h(s.end_time)}</TableCell>
                  <TableCell className="text-right">{s.status === "cancelled" ? "Cancelled" : `${s.booked} / ${s.capacity}`}</TableCell>
                  <TableCell className="text-right">{s.status === "cancelled" ? "—" : s.played}</TableCell>
                  <TableCell className="text-right">₱{s.collected.toLocaleString("en-PH")}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => onPlayers(s)} aria-label={`Players for ${formatShortDate(s.session_date)}`}>
                      <Users className="h-4 w-4" />
                      Players
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
