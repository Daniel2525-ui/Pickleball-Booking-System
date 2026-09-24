export const calculateCourtPrice = (courtName: string): number => {
    // Currently, a simple rule: Premium courts are 2000 cents ($20), others are 1500 cents ($15).
    // This could be expanded to look at the database court object if a "price" column is added.
    return courtName.includes("Premium") ? 2000 : 1500;
};
