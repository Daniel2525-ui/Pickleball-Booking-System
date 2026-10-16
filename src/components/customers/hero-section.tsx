"use client";

import { motion, type Variants } from "motion/react";
import {
  CalendarDays,
  Crosshair,
  Layers,
  Sparkles,
  Clock,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";

const smoothEase = [0.16, 1, 0.3, 1] as const;

export function HeroSection() {
  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.12,
        delayChildren: 0.05,
      },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 16, filter: "blur(6px)" },
    visible: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: {
        duration: 0.65,
        ease: smoothEase,
      },
    },
  };

  const statItemVariants: Variants = {
    hidden: { opacity: 0, y: 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5,
        ease: smoothEase,
      },
    },
  };

  return (
    <section
      id="home"
      className="scroll-mt-20 flex flex-col items-center justify-center text-center px-4 pt-16 pb-14 md:pt-24 md:pb-20 relative overflow-hidden"
    >
      {/* Precision Crosshair Ambient Background */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] md:w-[700px] md:h-[700px] bg-primary/8 rounded-full blur-[90px] md:blur-[130px] -z-10 pointer-events-none" />

      {/* Decorative Crosshair Reticle Graphic in background */}
      <motion.div
        initial={{ opacity: 0, scale: 0.85, rotate: -15 }}
        animate={{ opacity: 0.25, scale: 1, rotate: 0 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-[320px] md:size-[620px] rounded-full border border-dashed border-primary/20 pointer-events-none -z-10 flex items-center justify-center"
      >
        <div className="size-[200px] md:size-[400px] rounded-full border border-primary/15" />
        <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[1px] bg-gradient-to-b from-transparent via-primary/20 to-transparent" />
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[1px] bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      </motion.div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="flex flex-col items-center max-w-4xl w-full"
      >
        {/* Live Venue Status Pill */}
        <motion.div variants={itemVariants}>
          <div className="inline-flex items-center gap-2.5 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary mb-6 md:mb-8 shadow-xs hover:border-primary/50 transition-colors cursor-default">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            <span>Open Today • Live Court Availability in Butuan City</span>
          </div>
        </motion.div>

        {/* Headline */}
        <motion.h1
          variants={itemVariants}
          className="text-3xl sm:text-5xl md:text-7xl font-extrabold tracking-tighter max-w-4xl mb-4 sm:mb-5 leading-[1.12] md:leading-[1.08] text-foreground"
        >
          Dink with precision. <br className="hidden sm:inline" />
          <span className="text-primary">Play your game.</span>
        </motion.h1>

        {/* Supporting Copy */}
        <motion.p
          variants={itemVariants}
          className="text-sm sm:text-lg md:text-xl text-muted-foreground max-w-2xl mb-8 sm:mb-10 leading-relaxed font-normal"
        >
          Welcome to Crosshair Dinkers, Butuan City&apos;s premier dedicated pickleball venue. View real-time court availability, reserve your time slot in seconds, and play on professional tournament surfaces.
        </motion.p>

        {/* Action Buttons */}
        <motion.div
          variants={itemVariants}
          className="flex flex-col sm:flex-row w-full sm:w-auto items-center justify-center gap-3 sm:gap-3.5 mb-12 sm:mb-16"
        >
          <a
            href="#booking"
            className="group flex items-center justify-center gap-2.5 bg-primary text-primary-foreground px-6 sm:px-7 min-h-[48px] rounded-xl text-sm sm:text-base font-bold hover:bg-primary/90 transition-all shadow-md hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] w-full sm:w-auto"
          >
            <CalendarDays className="size-4.5 group-hover:rotate-6 transition-transform duration-200" />
            Book a Court Now
            <ArrowRight className="size-4 ml-1 group-hover:translate-x-1 transition-transform duration-200" />
          </a>
          <a
            href="#how-it-works"
            className="flex items-center justify-center gap-2 px-6 min-h-[48px] rounded-xl text-sm sm:text-base font-semibold border border-border bg-card/60 hover:bg-muted hover:border-primary/30 transition-all w-full sm:w-auto text-foreground"
          >
            How It Works
          </a>
        </motion.div>

        {/* Metric Badges Strip */}
        <motion.div
          variants={containerVariants}
          className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4 max-w-5xl w-full text-left"
        >
          <motion.div
            variants={statItemVariants}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
            className="bg-card border border-border/70 p-3.5 sm:p-5 rounded-xl shadow-xs hover:border-primary/40 hover:shadow-sm transition-all"
          >
            <div className="flex items-center gap-1.5 sm:gap-2 text-primary text-[11px] sm:text-xs font-semibold uppercase tracking-wider mb-1 sm:mb-1.5">
              <Layers className="size-3.5 shrink-0" />
              <span>Courts</span>
            </div>
            <p className="text-lg sm:text-xl md:text-2xl font-black text-foreground">4 Regulation</p>
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">Tournament acrylic cushion</p>
          </motion.div>

          <motion.div
            variants={statItemVariants}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
            className="bg-card border border-border/70 p-3.5 sm:p-5 rounded-xl shadow-xs hover:border-primary/40 hover:shadow-sm transition-all"
          >
            <div className="flex items-center gap-1.5 sm:gap-2 text-primary text-[11px] sm:text-xs font-semibold uppercase tracking-wider mb-1 sm:mb-1.5">
              <Sparkles className="size-3.5 shrink-0" />
              <span>Court Rate</span>
            </div>
            <p className="text-lg sm:text-xl md:text-2xl font-black text-foreground">From ₱200/hr</p>
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">Transparent hourly rate</p>
          </motion.div>

          <motion.div
            variants={statItemVariants}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
            className="bg-card border border-border/70 p-3.5 sm:p-5 rounded-xl shadow-xs hover:border-primary/40 hover:shadow-sm transition-all"
          >
            <div className="flex items-center gap-1.5 sm:gap-2 text-primary text-[11px] sm:text-xs font-semibold uppercase tracking-wider mb-1 sm:mb-1.5">
              <Clock className="size-3.5 shrink-0" />
              <span>Facility Hours</span>
            </div>
            <p className="text-lg sm:text-xl md:text-2xl font-black text-foreground">7 AM – 10 PM</p>
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">Open 7 days a week</p>
          </motion.div>

          <motion.div
            variants={statItemVariants}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
            className="bg-card border border-border/70 p-3.5 sm:p-5 rounded-xl shadow-xs hover:border-primary/40 hover:shadow-sm transition-all"
          >
            <div className="flex items-center gap-1.5 sm:gap-2 text-primary text-[11px] sm:text-xs font-semibold uppercase tracking-wider mb-1 sm:mb-1.5">
              <ShieldCheck className="size-3.5 shrink-0" />
              <span>Guarantee</span>
            </div>
            <p className="text-lg sm:text-xl md:text-2xl font-black text-foreground">Zero Conflicts</p>
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">Live reservation locking</p>
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
}
