export const calculateCourtPrice = (durationHours: number = 1): number => {
    // Pricing in Philippine Peso (PHP)
    // Flat rate of ₱200 per hour for all courts (1 to 3 hours allowed)
    if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 3) {
        throw new Error(
            `Invalid booking duration: ${durationHours}. Duration must be an integer between 1 and 3 hours.`
        );
    }

    const HOURLY_RATE = 200;
    return durationHours * HOURLY_RATE;
};
