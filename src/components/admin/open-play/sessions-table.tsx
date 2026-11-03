"use client";

import Link from "next/link";
import { AlertTriangle, MoreHorizontal, Users, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTime12h } from "@/lib/utils/formatTime";
import { type OpenPlayAdminSession, hasEnded } from "./open-play-container";

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
                        <DropdownMenu>
                          <DropdownMenuTrigger
                          render={
                            <button
                              type="button"
                              aria-label="Actions"
                              className="inline-flex items-center justify-center rounded-lg h-8 w-8 p-0 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                          }
                        >
                          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                        </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onClick={() => onPlayers(s)} className="cursor-pointer text-xs font-semibold">
                              <Users className="mr-2 h-4 w-4" />
                              Players
                            </DropdownMenuItem>
                            {s.status === "open" && !hasEnded(s) && (
                              <DropdownMenuItem
                                onClick={() => onCancel(s)}
                                disabled={s.awaiting}
                                className="cursor-pointer text-destructive focus:text-destructive text-xs font-semibold"
                              >
                                <XCircle className="mr-2 h-4 w-4" />
                                Cancel this date
                              </DropdownMenuItem>
                            )}
                            {s.status === "open" && !hasEnded(s) && s.awaiting && (
                              <p className="px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">Approve or reject the GCash payments waiting for verification first.</p>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {/* The bookings page has no date filter, so this opens the full list */}
                      {flagged && (
                        <Link href="/admin/bookings" className="text-sm font-medium underline underline-offset-2">View booking</Link>
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
