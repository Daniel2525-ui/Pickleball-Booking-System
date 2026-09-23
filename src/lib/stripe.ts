import Stripe from "stripe";

// We don't throw an error here to prevent module-level crashes during build or dev if the key is missing.
// Instead, we pass an empty string if missing, and the route handlers should check before using it.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
    typescript: true,
});
