"use client";

import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTime12h } from "@/lib/utils/formatTime";
import type { OpenPlayAdminSession } from "./open-play-container";

const formatDate = (d: string) =>
  new Date(`${d}T12:00:00+08:00`).toLocaleDateString("en-US", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric" });

interface Props {
  sessions: OpenPlayAdminSession[];
  loading: boolean;
  selectedId?: string;
  onPlayers: (s: OpenPlayAdminSession) => void;
  onCancel: (s: OpenPlayAdminSession) => void;
}

export function SessionsTable({ sessions, loading, selectedId, onPlayers, onCancel }: Props) {
  return (
    <Card className="border border-border shadow-2xs">
      <CardHeader>
        <CardTitle className="text-base font-bold">Upcoming sessions</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Booked</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
            ) : sessions.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">No sessions in the next 28 days.</TableCell></TableRow>
            ) : (
              sessions.map((s) => {
                const flagged = s.status === "flagged";
                const cancelled = s.status === "cancelled";
                return (
                  <TableRow key={s.id} className={cancelled ? "opacity-60" : flagged ? "bg-amber-500/10" : s.id === selectedId ? "bg-primary/5" : ""}>
                    <TableCell className="font-semibold">{formatDate(s.session_date)}</TableCell>
                    <TableCell>{formatTime12h(s.start_time)} – {formatTime12h(s.end_time)}</TableCell>
                    <TableCell>{flagged ? "—" : `${s.booked} / ${s.capacity}`}</TableCell>
                    <TableCell>
                      {flagged ? (
                        <span className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                          Not created: {s.flag_reason}
                        </span>
                      ) : (
                        <Badge variant="outline" className="text-xs font-semibold">
                          {cancelled ? "Cancelled" : s.booked >= s.capacity ? "Full" : "Open"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!flagged && (
                        <Button variant="ghost" size="sm" onClick={() => onPlayers(s)}>Players</Button>
                      )}
                      {s.status === "open" && (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => onCancel(s)}>Cancel this date</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
