"use client";

import { useState } from "react";
import {
  MoreHorizontal,
  Pencil,
  Trash2,
  Eye,
  Search,
  MapPin,
  Clock,
  DollarSign,
  Users,
  CheckCircle2,
  XCircle,
  WrenchIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";

// ─── Mock Data ────────────────────────────────────────────────────────────────
// Replace this with real Supabase data once the service is ready
type CourtStatus = "available" | "maintenance" | "closed";

interface Court {
  id: string;
  name: string;
  location: string;
  surface: string;
  status: CourtStatus;
  rate_per_hour: number;
  max_players: number;
  open_time: string;
  close_time: string;
  total_bookings: number;
}

const MOCK_COURTS: Court[] = [
  {
    id: "court-1",
    name: "Court A",
    location: "Main Building – Ground Floor",
    surface: "Hardcourt",
    status: "available",
    rate_per_hour: 300,
    max_players: 4,
    open_time: "06:00",
    close_time: "22:00",
    total_bookings: 128,
  },
  {
    id: "court-2",
    name: "Court B",
    location: "Main Building – Ground Floor",
    surface: "Hardcourt",
    status: "available",
    rate_per_hour: 300,
    max_players: 4,
    open_time: "06:00",
    close_time: "22:00",
    total_bookings: 95,
  },
  {
    id: "court-3",
    name: "Court C",
    location: "Annex Wing – East Side",
    surface: "Rubberized",
    status: "maintenance",
    rate_per_hour: 350,
    max_players: 4,
    open_time: "07:00",
    close_time: "21:00",
    total_bookings: 74,
  },
  {
    id: "court-4",
    name: "Court D",
    location: "Annex Wing – East Side",
    surface: "Rubberized",
    status: "available",
    rate_per_hour: 350,
    max_players: 4,
    open_time: "07:00",
    close_time: "21:00",
    total_bookings: 61,
  },
  {
    id: "court-5",
    name: "Court E – Premium",
    location: "VIP Hall – 2nd Floor",
    surface: "Synthetic Grass",
    status: "available",
    rate_per_hour: 500,
    max_players: 4,
    open_time: "08:00",
    close_time: "22:00",
    total_bookings: 212,
  },
  {
    id: "court-6",
    name: "Court F – Outdoor",
    location: "Rooftop Deck",
    surface: "Concrete",
    status: "closed",
    rate_per_hour: 250,
    max_players: 4,
    open_time: "06:00",
    close_time: "20:00",
    total_bookings: 43,
  },
];

// ─── Status Config ─────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<CourtStatus, { label: string; className: string; Icon: React.ElementType }> = {
  available: {
    label: "Available",
    className: "bg-emerald-500/15 text-emerald-700 border-emerald-200 dark:text-emerald-400 dark:border-emerald-800",
    Icon: CheckCircle2,
  },
  maintenance: {
    label: "Maintenance",
    className: "bg-amber-500/15 text-amber-700 border-amber-200 dark:text-amber-400 dark:border-amber-800",
    Icon: WrenchIcon,
  },
  closed: {
    label: "Closed",
    className: "bg-red-500/15 text-red-700 border-red-200 dark:text-red-400 dark:border-red-800",
    Icon: XCircle,
  },
};

// ─── Court Card ────────────────────────────────────────────────────────────────
function CourtCard({ court }: { court: Court }) {
  const { label, className, Icon } = STATUS_CONFIG[court.status];

  return (
    <Card className="group flex flex-col overflow-hidden transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
      {/* Status color banner */}
      <div
        className={`h-1.5 w-full ${
          court.status === "available"
            ? "bg-emerald-500"
            : court.status === "maintenance"
            ? "bg-amber-500"
            : "bg-red-500"
        }`}
      />

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base truncate">{court.name}</h3>
            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{court.location}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="outline" className={`flex items-center gap-1 text-xs ${className}`}>
              <Icon className="h-3 w-3" />
              {label}
            </Badge>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem className="cursor-pointer">
                  <Eye className="mr-2 h-4 w-4" />
                  View Details
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer">
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit Court
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Court
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pb-3 flex-1">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="flex flex-col gap-0.5 rounded-lg bg-muted/50 px-3 py-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> Rate / Hour
            </span>
            <span className="font-semibold text-sm">₱{court.rate_per_hour.toLocaleString()}</span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-lg bg-muted/50 px-3 py-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3" /> Max Players
            </span>
            <span className="font-semibold text-sm">{court.max_players} players</span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-lg bg-muted/50 px-3 py-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Open Hours
            </span>
            <span className="font-semibold text-sm">{court.open_time} – {court.close_time}</span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-lg bg-muted/50 px-3 py-2">
            <span className="text-xs text-muted-foreground">Surface</span>
            <span className="font-semibold text-sm">{court.surface}</span>
          </div>
        </div>
      </CardContent>

      <CardFooter className="pt-3 border-t">
        <span className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{court.total_bookings}</span> total bookings
        </span>
      </CardFooter>
    </Card>
  );
}

// ─── Main Container ────────────────────────────────────────────────────────────
export default function CourtsContainer() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [surfaceFilter, setSurfaceFilter] = useState("all");

  const filtered = MOCK_COURTS.filter((court) => {
    const matchesSearch =
      !search ||
      court.name.toLowerCase().includes(search.toLowerCase()) ||
      court.location.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || court.status === statusFilter;
    const matchesSurface =
      surfaceFilter === "all" || court.surface === surfaceFilter;
    return matchesSearch && matchesStatus && matchesSurface;
  });

  const counts = {
    total: MOCK_COURTS.length,
    available: MOCK_COURTS.filter((c) => c.status === "available").length,
    maintenance: MOCK_COURTS.filter((c) => c.status === "maintenance").length,
    closed: MOCK_COURTS.filter((c) => c.status === "closed").length,
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Summary Pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Courts", value: counts.total, color: "text-foreground" },
          { label: "Available", value: counts.available, color: "text-emerald-600 dark:text-emerald-400" },
          { label: "In Maintenance", value: counts.maintenance, color: "text-amber-600 dark:text-amber-400" },
          { label: "Closed", value: counts.closed, color: "text-red-600 dark:text-red-400" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border bg-card px-4 py-3 shadow-sm">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className={`text-2xl font-bold mt-0.5 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search courts by name or location..."
            className="pl-9 bg-background"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[160px] bg-background">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="available">Available</SelectItem>
            <SelectItem value="maintenance">Maintenance</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={surfaceFilter} onValueChange={setSurfaceFilter}>
          <SelectTrigger className="w-full sm:w-[160px] bg-background">
            <SelectValue placeholder="Surface" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Surfaces</SelectItem>
            <SelectItem value="Hardcourt">Hardcourt</SelectItem>
            <SelectItem value="Rubberized">Rubberized</SelectItem>
            <SelectItem value="Synthetic Grass">Synthetic Grass</SelectItem>
            <SelectItem value="Concrete">Concrete</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Courts Grid */}
      {filtered.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed text-muted-foreground text-sm">
          No courts match your filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((court) => (
            <CourtCard key={court.id} court={court} />
          ))}
        </div>
      )}
    </div>
  );
}
