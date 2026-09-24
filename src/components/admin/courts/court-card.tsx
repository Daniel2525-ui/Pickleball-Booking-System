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
import { Card, CardHeader } from "@/components/ui/card";
import { Court } from "@/lib/services/courts/courtsTypes";

const statusConfig: Record<
  string,
  { label: string; className: string; barColor: string; Icon: React.ElementType }
> = {
  active: {
    label: "Available",
    className:
      "bg-emerald-500/15 text-emerald-700 border-emerald-200 dark:text-emerald-400 dark:border-emerald-800",
    barColor: "bg-emerald-500",
    Icon: CheckCircle2,
  },
  maintenance: {
    label: "Maintenance",
    className:
      "bg-amber-500/15 text-amber-700 border-amber-200 dark:text-amber-400 dark:border-amber-800",
    barColor: "bg-amber-500",
    Icon: WrenchIcon,
  },
  occupied: {
    label: "Occupied",
    className:
      "bg-red-500/15 text-red-700 border-red-200 dark:text-red-400 dark:border-red-800",
    barColor: "bg-red-500",
    Icon: XCircle,
  },
};

interface CourtCardProps {
  court: Court;
  onEdit?: (court: Court) => void;
  onDelete?: (id: string) => void;
}

export function CourtCard({ court, onEdit, onDelete }: CourtCardProps) {
  const status = statusConfig[court.status?.toLowerCase()] ?? statusConfig.available;
  const { label, className, barColor, Icon } = status;

  return (
    <Card className="group overflow-hidden transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
      {/* Status color banner */}
      <div className={`h-1.5 w-full ${barColor}`} />

      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-base truncate">{court.name}</h3>

          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="outline" className={`flex items-center gap-1 text-xs ${className}`}>
              <Icon className="h-3 w-3" />
              {label}
            </Badge>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                }
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Open menu</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                  <DropdownMenuItem className="cursor-pointer" onClick={() => onEdit?.(court)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit Court
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer text-destructive focus:text-destructive"
                    onClick={() => onDelete?.(court.id)}
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
    </Card>
  );
}