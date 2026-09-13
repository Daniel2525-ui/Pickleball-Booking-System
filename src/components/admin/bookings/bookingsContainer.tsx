"use client"

import { useState } from "react"
import BookingFilters from "./booking-filters"
import BookingsTable from "./bookings-table"

export const BookingsContainer = () => {
    const [filters, setFilters] = useState({
        search: "",
        status: "",
        courtId: "",
    })

    return (
        <div className="flex flex-col gap-4 mt-2">
            <BookingFilters onFilterChange={setFilters} />
            <BookingsTable filters={filters}></BookingsTable>
        </div>
    )
}