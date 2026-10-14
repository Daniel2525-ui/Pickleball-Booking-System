"use client";

import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";

interface FAQItem {
  question: string;
  answer: string;
}

const faqs: FAQItem[] = [
  {
    question: "What footwear and attire are required on the courts?",
    answer:
      "Non-marking athletic court shoes or tennis sneakers are mandatory to protect our competition-grade acrylic surface and ensure player safety against slips. Comfortable sportswear is recommended.",
  },
  {
    question: "Do I need to bring my own paddles and pickleballs?",
    answer:
      "Not necessarily! While you are welcome to bring your personal gear, we provide premium USAPA-approved composite paddles and official tournament balls for rent at our front desk for a nominal fee.",
  },
  {
    question: "How does the online court reservation and payment work?",
    answer:
      "Select your date on our live schedule, choose your preferred court and time slot, and click 'Continue to Checkout'. Payments are processed securely via Stripe. Once complete, your booking confirmation pass appears immediately in your 'My Bookings' tab.",
  },
  {
    question: "What is your cancellation and rescheduling policy?",
    answer:
      "Players can cancel or reschedule reservations up to 2 hours prior to the booked time slot directly from the 'My Bookings' portal. Cancellations within the eligible window receive full credit.",
  },
  {
    question: "What does the 'Pending' status on the court grid mean?",
    answer:
      "When a player selects an open court and proceeds toward payment, the slot is locked as 'Pending' for 10 minutes to guarantee zero double-booking. If checkout is abandoned, the slot releases back to 'Available' automatically.",
  },
  {
    question: "Are the courts weather-protected for rain and night play?",
    answer:
      "Yes. Crosshair Dinkers is an all-weather covered facility equipped with anti-glare, high-lux overhead LED stadium lighting, ensuring uninterrupted matches day or night, rain or shine.",
  },
];

export function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="faq" className="scroll-mt-20 w-full py-16 md:py-24 border-t bg-muted/20">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-3 text-foreground">
            Frequently Asked Questions
          </h2>
          <p className="text-muted-foreground text-base md:text-lg max-w-2xl mx-auto">
            Everything you need to know about court bookings, gear rentals, and facility rules before stepping on the court.
          </p>
        </div>

        <div className="space-y-3.5">
          {faqs.map((faq, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div
                key={idx}
                className="rounded-xl border bg-card shadow-xs transition-colors overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggle(idx)}
                  className="w-full px-5 py-4 text-left flex items-center justify-between gap-4 font-semibold text-sm md:text-base hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-expanded={isOpen}
                >
                  <span className="flex items-center gap-3">
                    <span className="size-6 rounded-md bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <span>{faq.question}</span>
                  </span>
                  <ChevronDown
                    className={`size-4 text-muted-foreground shrink-0 transition-transform duration-200 ${
                      isOpen ? "rotate-180 text-primary" : ""
                    }`}
                  />
                </button>

                {isOpen && (
                  <div className="px-5 pb-5 pt-1 text-sm md:text-base text-muted-foreground leading-relaxed border-t border-border/50 animate-in fade-in-50 duration-200">
                    <div className="pl-9">{faq.answer}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-10 p-5 rounded-2xl border border-dashed text-center flex flex-col sm:flex-row items-center justify-between gap-4 bg-background">
          <div className="text-left">
            <h4 className="font-bold text-sm text-foreground">Still have questions?</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Contact our facility desk directly for corporate bookings or tournament inquiries.
            </p>
          </div>
          <a
            href="#contact"
            className="text-xs font-semibold px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors whitespace-nowrap"
          >
            Contact Venue Staff
          </a>
        </div>
      </div>
    </section>
  );
}
