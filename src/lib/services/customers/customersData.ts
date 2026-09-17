import { Customer } from "./customersTypes";

export const mockCustomers: Customer[] = [
    {
        id: "1",
        name: "John Doe",
        email: "john.doe@example.com",
        phone: "+1 (555) 123-4567",
        status: "active",
        totalBookings: 12,
        joinedAt: "2023-01-15T08:00:00Z"
    },
    {
        id: "2",
        name: "Jane Smith",
        email: "jane.smith@example.com",
        phone: "+1 (555) 987-6543",
        status: "active",
        totalBookings: 5,
        joinedAt: "2023-03-22T10:30:00Z"
    },
    {
        id: "3",
        name: "Michael Johnson",
        email: "michael.j@example.com",
        phone: "+1 (555) 246-8135",
        status: "inactive",
        totalBookings: 1,
        joinedAt: "2023-06-10T14:15:00Z"
    },
    {
        id: "4",
        name: "Sarah Williams",
        email: "sarah.w@example.com",
        phone: "+1 (555) 369-2580",
        status: "active",
        totalBookings: 28,
        joinedAt: "2022-11-05T09:20:00Z"
    },
    {
        id: "5",
        name: "David Brown",
        email: "david.b@example.com",
        phone: "+1 (555) 159-7532",
        status: "active",
        totalBookings: 8,
        joinedAt: "2026-09-10T16:45:00Z"
    }
];

export const fetchMockCustomers = async (): Promise<{ data: Customer[], error: null }> => {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500));
    return { data: mockCustomers, error: null };
};
