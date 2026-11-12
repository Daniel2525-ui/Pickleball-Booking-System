"use client";

import {
  MoreHorizontal,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  WrenchIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Court } from "@/lib/services/courts/courtsTypes";
import { CourtBooking, courtBookingName } from "@/lib/services/courts/courtsData.service";
import { formatTime12h, formatShortDate } from "@/lib/utils/formatTime";

const statusConfig: Record<
  string,
  { label: string; description: string; className: string; barColor: string; Icon: React.ElementType }
> = {
  active: {
    label: "Available",
    description: "Open for player reservations",
    className:
      "bg-emerald-500/15 text-emerald-700 border-emerald-200 dark:text-emerald-400 dark:border-emerald-800",
    barColor: "bg-emerald-500",
    Icon: CheckCircle2,
  },
  available: {
    label: "Available",
    description: "Open for player reservations",
    className:
      "bg-emerald-500/15 text-emerald-700 border-emerald-200 dark:text-emerald-400 dark:border-emerald-800",
    barColor: "bg-emerald-500",
    Icon: CheckCircle2,
  },
  maintenance: {
    label: "Maintenance",
    description: "Temporarily closed for maintenance",
    className:
      "bg-amber-500/15 text-amber-700 border-amber-200 dark:text-amber-400 dark:border-amber-800",
    barColor: "bg-amber-500",
    Icon: WrenchIcon,
  },
  occupied: {
    label: "Occupied",
    description: "Active reservation in progress",
    className:
      "bg-red-500/15 text-red-700 border-red-200 dark:text-red-400 dark:border-red-800",
    barColor: "bg-red-500",
    Icon: XCircle,
  },
};

interface CourtCardProps {
  court: Court;
  /** Today's booking on this court right now, and the next one */
  today?: { current: CourtBooking | null; next: CourtBooking | null };
  onEdit?: (court: Court) => void;
  onDelete?: (court: Court) => void;
}

export const CourtCard = ({ court, today, onEdit, onDelete }: CourtCardProps) => {
  const status = statusConfig[court.status?.toLowerCase()] ?? statusConfig.active;
  const { label, description, className, barColor, Icon } = status;
  const inMaintenance = court.status?.toLowerCase() === "maintenance";
  const maintenanceLine = [court.maintenance_note || description, court.maintenance_until && `back ${formatShortDate(court.maintenance_until)}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card className="group overflow-hidden gap-0 py-0 shadow-none transition-colors hover:border-primary/40">
      {/* The court's photo when staff added one (the landing page shows it too), else a plain court pattern */}
      <div className="relative h-28 bg-muted">
        {court.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a Supabase Storage public URL; next/image would need per-venue remote config
          <img src={court.photo_url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div aria-hidden className="h-full w-full bg-[repeating-linear-gradient(135deg,#EEF1EF_0_12px,#E6EAE8_12px_24px)]" />
        )}
        <span className={`absolute inset-x-0 bottom-0 h-1 ${barColor}`} aria-hidden />
      </div>

      <CardHeader className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-display font-bold text-lg truncate">{court.name}</h3>
            {court.details && <p className="text-xs text-muted-foreground truncate">{court.details}</p>}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="outline" className={`flex items-center gap-1 text-xs font-medium ${className}`}>
              <Icon className="h-3 w-3" />
              {label}
            </Badge>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 sm:size-8 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity rounded-lg"
                  />
                }
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Actions for {court.name}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Court Actions</DropdownMenuLabel>
                  <DropdownMenuItem className="cursor-pointer" onClick={() => onEdit?.(court)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit Court
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer text-destructive focus:text-destructive"
                    onClick={() => onDelete?.(court)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Court
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pt-0 pb-4">
        {inMaintenance ? (
          <p className="text-xs text-muted-foreground">{maintenanceLine}</p>
        ) : (
          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {today?.current && (
              <p>
                <span className="font-semibold text-foreground">Now:</span> {courtBookingName(today.current)} until {formatTime12h(today.current.end_time)}
              </p>
            )}
            {today?.next && (
              <p>
                <span className="font-semibold text-foreground">Next:</span> {formatTime12h(today.next.start_time)} · {courtBookingName(today.next)}
              </p>
            )}
            {!today?.current && !today?.next && <p>No more bookings today</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
};