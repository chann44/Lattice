"use client"

import { motion } from "framer-motion"
import Link from "next/link"
import { useState, useCallback } from "react"

const ACCENT = "#d4ff3a"
const CARD_BG = "#0c0c0c"
const PAGE_BG = "#f5f2ed"

/** Renders a concave quarter-circle cutout at a panel corner.
 *  Works by placing a filled circle whose center aligns with the panel corner,
 *  visible only through a 20×20 overflow-hidden window — revealing one quadrant. */
function ConcaveBall({
  side,
  color = CARD_BG,
}: {
  side: "bottom-left" | "bottom-right" | "top-left" | "top-right"
  color?: string
}) {
  const containerPos: Record<string, React.CSSProperties> = {
    "bottom-left": { bottom: -20, left: 0 },
    "bottom-right": { bottom: -20, right: 0 },
    "top-left": { top: -20, left: 0 },
    "top-right": { top: -20, right: 0 },
  }
  const circlePos: Record<string, React.CSSProperties> = {
    "bottom-left": { bottom: 0, right: 0 },
    "bottom-right": { bottom: 0, left: 0 },
    "top-left": { top: 0, right: 0 },
    "top-right": { top: 0, left: 0 },
  }
  return (
    <span
      className="pointer-events-none absolute overflow-hidden"
      style={{ width: 20, height: 20, ...containerPos[side] }}
    >
      <span
        className="absolute rounded-full"
        style={{ width: 40, height: 40, background: color, ...circlePos[side] }}
      />
    </span>
  )
}

function AnimatedBackground() {
  return (
    <div className="absolute inset-0">
      {/* Primary accent orb — top-left */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 800,
          height: 800,
          background: `radial-gradient(circle, ${ACCENT}18 0%, transparent 65%)`,
          top: "-25%",
          left: "-8%",
        }}
        animate={{ x: [0, 90, -50, 0], y: [0, -70, 110, 0], scale: [1, 1.08, 0.94, 1] }}
        transition={{ duration: 24, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* Secondary accent orb — bottom-right */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 560,
          height: 560,
          background: `radial-gradient(circle, ${ACCENT}12 0%, transparent 65%)`,
          bottom: "-12%",
          right: "3%",
        }}
        animate={{ x: [0, -70, 90, 0], y: [0, 90, -60, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut", delay: 7 }}
      />
      {/* Cool blue accent — mid */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 380,
          height: 380,
          background: `radial-gradient(circle, rgba(100,210,255,0.07) 0%, transparent 65%)`,
          top: "35%",
          right: "22%",
        }}
        animate={{ x: [0, 50, -70, 0], y: [0, -60, 40, 0] }}
        transition={{ duration: 30, repeat: Infinity, ease: "easeInOut", delay: 4 }}
      />

      {/* Lattice grid overlay */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: [
            "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)",
            "linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
          ].join(", "),
          backgroundSize: "72px 72px",
        }}
      />
      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 85% 85% at 50% 50%, transparent 40%, ${CARD_BG}cc 100%)`,
        }}
      />
    </div>
  )
}

function Navbar() {
  return (
    <div
      className="absolute top-0 left-0 right-0 z-20 hidden lg:flex justify-between w-full"
      style={{ pointerEvents: "auto" }}
    >
      {/* Left: Brand */}
      <motion.div
        className="relative rounded-br-[20px] px-8 pb-4 pt-1.5"
        style={{ background: PAGE_BG }}
        initial={{ y: -48, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      >
        <Link
          className="font-display relative z-10 text-sm font-bold tracking-tight text-black"
          href="/"
        >
          Lattice ®
        </Link>
        <ConcaveBall side="bottom-left" color={CARD_BG} />
        <ConcaveBall side="bottom-right" color={CARD_BG} />
      </motion.div>

      {/* Center: Nav links */}
      <motion.div
        className="relative hidden items-center rounded-b-[20px] px-3 pb-3 pt-1.5 md:flex"
        style={{ background: PAGE_BG }}
        initial={{ y: -48, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
      >
        <div className="relative z-10 flex items-center gap-7 px-4">
          {["Components", "Docs", "Showcase", "Blog"].map((item, i) => (
            <motion.div
              key={item}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 + i * 0.07 }}
            >
              <Link
                className="text-sm font-medium text-black/60 transition-colors hover:text-black"
                href="#"
              >
                {item}
              </Link>
            </motion.div>
          ))}
        </div>
        <ConcaveBall side="bottom-left" color={CARD_BG} />
        <ConcaveBall side="bottom-right" color={CARD_BG} />
      </motion.div>

      {/* Right: CTA */}
      <motion.div
        className="relative flex items-center rounded-bl-[20px] px-3 pb-4 pt-1.5"
        style={{ background: PAGE_BG }}
        initial={{ y: -48, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.16 }}
      >
        <Link
          className="relative z-10 rounded-full bg-black px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-black/80"
          href="#"
        >
          Get Started
        </Link>
        <ConcaveBall side="bottom-right" color={CARD_BG} />
        <ConcaveBall side="bottom-left" color={CARD_BG} />
      </motion.div>
    </div>
  )
}

/* Mobile-only top bar */
function MobileNav() {
  return (
    <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-5 py-4 lg:hidden">
      <motion.span
        className="font-display text-sm font-bold"
        style={{ color: ACCENT }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        Lattice ®
      </motion.span>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
        <Link
          className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black"
          href="#"
        >
          Get Started
        </Link>
      </motion.div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])
  return (
    <button
      onClick={handleCopy}
      className="text-white/40 transition-colors hover:text-white"
      aria-label="Copy command"
    >
      {copied ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 12 4 10" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
      )}
    </button>
  )
}

const FEATURES = [
  { num: "01", label: "Agent first source control " },
  { num: "02", label: "Built-in app/runtime deployment" },
]

export default function LandingPage() {
  return (
    <div className="min-h-dvh p-2 md:p-4" style={{ background: PAGE_BG }}>
      <div className="group relative flex min-h-[calc(100vh-16px)] md:min-h-[calc(100vh-32px)]">
        <Navbar />
        <MobileNav />

        {/* Black card background */}
        <div
          className="absolute inset-0 z-0 overflow-hidden rounded-[28px]"
          style={{ background: CARD_BG }}
        >
          <AnimatedBackground />
        </div>

        {/* Page content */}
        <div className="relative z-10 flex min-h-[calc(100vh-16px)] flex-1 flex-col justify-between pb-6 pt-16 md:min-h-[calc(100vh-32px)] md:pb-10">
          {/* ── Hero ── */}
          <div className="mt-16 flex flex-1 flex-col items-center justify-center px-4 md:mt-20">
            {/* Row 1: "Lattice" + horizontal rule */}
            <motion.div
              className="flex items-center gap-4 md:gap-6"
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
            >
              <h1
                className="font-display text-[58px] font-bold leading-none tracking-[-4px] sm:text-[82px] sm:tracking-[-7px] md:text-[124px] md:tracking-[-10px]"
                style={{ color: ACCENT }}
              >
                Lattice
              </h1>
              <motion.div
                className="h-px flex-shrink-0 sm:translate-y-3"
                style={{ background: ACCENT, width: 0 }}
                animate={{ width: "clamp(80px, 12vw, 220px)" }}
                transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.7 }}
              />
            </motion.div>

            {/* Row 2: description + italic companion word */}
            <motion.div
              className="flex items-end"
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.4 }}
            >
              <h2
                className="-translate-x-8 font-editorial text-[58px] font-semibold italic leading-none sm:text-[82px] md:-translate-x-12 md:text-[124px] max-md:pl-8"
                style={{ color: ACCENT }}
              >
                Craft
              </h2>
            </motion.div>

            {/* CTA row */}
            <motion.div
              className="mt-10 flex flex-col items-center gap-3 sm:mt-14 sm:flex-row"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.6 }}
            >
              <div className="group/copy flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/10 bg-black/50 p-3 backdrop-blur-sm">
                <p className="font-mono text-sm text-white">
                  Open{" "}
                  <span className="text-white/50">@skills.md</span>
                </p>
                <span className="max-md:hidden">
                  <CopyButton text="skills.md" />
                </span>
              </div>
              <Link
                className="flex h-10 items-center rounded-xl bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-white/90"
                href="#"
              >
                Open Skills
              </Link>
            </motion.div>
          </div>

          {/* ── Feature tiles ── */}
          <motion.div
            className="grid w-full grid-cols-1 gap-4 px-4 md:grid-cols-2 md:px-6 lg:grid-cols-4"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.78 }}
          >
            <div className="max-lg:hidden" />
            {FEATURES.map(({ num, label }) => (
              <motion.div
                key={num}
                className="flex items-center justify-between rounded-lg px-5 py-2.5"
                style={{ background: PAGE_BG }}
                whileHover={{ scale: 1.02 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-black font-mono text-xs text-white">
                    {num}
                  </div>
                  <span className="text-sm font-medium text-black">{label}</span>
                </div>
                <span className="text-2xl font-thin text-black">+</span>
              </motion.div>
            ))}
            <div className="max-lg:hidden" />
          </motion.div>
        </div>
      </div>
    </div>
  )
}
