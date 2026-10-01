'use client';

/**
 * PrintX Landing Page
 * Animated marketing page: hero with live product showcase, features grid,
 * how-it-works workflow, and footer. Dark navy/cyan brand system.
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import {
  Printer,
  ScanLine,
  Smartphone,
  FileText,
  Zap,
  BarChart3,
  QrCode,
  BellRing,
  Store,
  LogIn,
  ShieldCheck,
  Mail,
  ArrowRight,
  CheckCheck,
  Loader2,
  Inbox,
  Volume2,
  Check,
  XCircle,
  Sparkles,
  Layers,
} from 'lucide-react';
import PrintXLogo from '../components/ui/PrintXLogo';

/* ------------------------------------------------------------------ */
/* Live token visual — cycles Received → Printing → Ready              */
/* ------------------------------------------------------------------ */
const TOKEN_STAGES = [
  { key: 'received', label: 'Received', icon: <Inbox className="w-4 h-4" />, cls: 'bg-slate-500/15 text-slate-300 border-slate-500/40' },
  { key: 'printing', label: 'Printing', icon: <Loader2 className="w-4 h-4 animate-spin" />, cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40 shadow-[0_0_14px_rgba(6,182,212,0.35)]' },
  { key: 'ready', label: 'Ready', icon: <CheckCheck className="w-4 h-4" />, cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 shadow-[0_0_14px_rgba(16,185,129,0.35)]' },
];

function LiveTokenCard() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setStage((s) => (s + 1) % TOKEN_STAGES.length), 2200);
    return () => clearInterval(t);
  }, []);

  const current = TOKEN_STAGES[stage];

  return (
    <motion.div
      initial={{ opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.55, type: 'spring', stiffness: 200, damping: 22 }}
      className="relative rounded-2xl border border-[#1E2D4A] bg-[#152238]/90 backdrop-blur-xl p-5 w-64 shadow-2xl"
    >
      {/* Window dots */}
      <div className="flex items-center gap-1.5 mb-4">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
        <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
        <span className="text-[10px] font-bold text-slate-500 ml-2 uppercase tracking-wider">Live Queue</span>
      </div>

      <div className="text-[10px] font-extrabold uppercase tracking-widest text-cyan-400 mb-1">
        Token
      </div>
      <div className="text-3xl font-black text-white tracking-tight">#TK-42</div>

      <div className="mt-2 text-xs text-slate-400 flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5" />
        assignment-notes.pdf · 12 pages
      </div>

      {/* Status pill */}
      <div className="mt-4">
        <div key={current.key} className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border transition-colors duration-500 ${current.cls}`}>
            {current.icon}
            {current.label}
          </span>
        </div>
        {/* Progress dots */}
        <div className="flex items-center gap-1.5 mt-3">
          {TOKEN_STAGES.map((s, i) => (
            <span
              key={s.key}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                i <= stage ? 'w-6 bg-cyan-400' : 'w-3 bg-slate-700'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Chime toast when ready */}
      {stage === 2 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-300"
        >
          <Volume2 className="w-3.5 h-3.5" />
          Counter chime + WhatsApp sent
        </motion.div>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* QR scanner card — laser line sweeping up & down                     */
/* ------------------------------------------------------------------ */
function QrScannerCard() {
  return (
    <motion.div
      initial={{ opacity: 0, x: -28 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.4, type: 'spring', stiffness: 200, damping: 22 }}
      className="relative rounded-2xl border border-[#1E2D4A] bg-[#152238]/90 backdrop-blur-xl p-5 w-64 shadow-2xl"
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
          Scan at Counter
        </span>
        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
          </span>
          Live
        </span>
      </div>

      {/* QR frame with laser sweep */}
      <div className="relative rounded-xl bg-white p-3 overflow-hidden">
        <QRCodeSVG
          value="https://printx.in/s/sharma_xerox"
          size={150}
          bgColor="#FFFFFF"
          fgColor="#0B132B"
          level="M"
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
        {/* Laser line */}
        <div className="qr-laser pointer-events-none absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_2px_rgba(6,182,212,0.7)]" />
        {/* Corner brackets */}
        <span className="absolute top-1 left-1 w-4 h-4 border-t-2 border-l-2 border-cyan-500 rounded-tl" />
        <span className="absolute top-1 right-1 w-4 h-4 border-t-2 border-r-2 border-cyan-500 rounded-tr" />
        <span className="absolute bottom-1 left-1 w-4 h-4 border-b-2 border-l-2 border-cyan-500 rounded-bl" />
        <span className="absolute bottom-1 right-1 w-4 h-4 border-b-2 border-r-2 border-cyan-500 rounded-br" />
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-slate-400">Shop handle</span>
        <span className="font-bold text-cyan-300">@sharma_xerox</span>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* 3D printer + A4 paper stack — pure CSS isometric visual             */
/* ------------------------------------------------------------------ */
function Printer3DStack() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.9, type: 'spring', stiffness: 200, damping: 22 }}
      className="relative hidden lg:block w-[190px] select-none"
      style={{ perspective: '800px' }}
      aria-hidden="true"
    >
      {/* A4 paper stack */}
      <div className="absolute -top-8 left-3 right-3 z-0">
        <div className="relative h-16" style={{ transform: 'rotateX(52deg) rotateZ(-42deg)', transformStyle: 'preserve-3d' }}>
          <div className="absolute inset-0 rounded-[3px] bg-slate-300 border border-slate-400/70" />
          <div className="absolute inset-0 translate-y-[3px] rounded-[3px] bg-slate-200" />
          <div className="absolute inset-0 translate-y-[6px] rounded-[3px] bg-white shadow-md" />
          <span className="absolute left-3 right-3 top-3 h-1 rounded bg-slate-400/60" />
          <span className="absolute left-3 right-8 top-6 h-1 rounded bg-slate-400/40" />
          <span className="absolute left-3 right-5 top-9 h-1 rounded bg-cyan-500/50" />
        </div>
      </div>

      {/* Printer body — isometric prism */}
      <div className="relative z-10 mt-10" style={{ transform: 'rotateX(52deg) rotateZ(-42deg)', transformStyle: 'preserve-3d' }}>
        {/* top face */}
        <div className="w-40 h-32 rounded-xl bg-gradient-to-br from-[#1B2C4A] to-[#13233E] border border-[#2A3F63] shadow-[0_18px_40px_rgba(2,8,23,0.6)]" />
        {/* right face */}
        <div className="absolute top-0 left-full w-8 h-32 rounded-r-xl bg-gradient-to-b from-[#0F1B31] to-[#0B132B] border border-[#22314F] border-l-0" />
        {/* front face */}
        <div className="absolute top-full left-0 w-40 h-8 rounded-b-xl bg-gradient-to-r from-[#16263F] to-[#0E1A2E] border border-[#22314F] border-t-0" />
      </div>

      {/* Paper output slot + sheet emerging */}
      <div className="absolute z-20 left-4 bottom-2 right-4">
        <motion.div
          animate={{ y: [10, 2, 10] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className="mx-auto w-28 rounded-t-sm border border-b-0 border-slate-500/50 bg-gradient-to-b from-white to-slate-200 px-2 pt-2 pb-3 shadow-lg"
        >
          <span className="block h-1 rounded bg-slate-400/60" />
          <span className="mt-1.5 block h-1 w-3/4 rounded bg-slate-400/40" />
          <span className="mt-1.5 block h-1 w-1/2 rounded bg-cyan-600/50" />
        </motion.div>
        <div className="h-1 rounded-full bg-[#0A1424] border border-[#22314F]/70 shadow-inner" />
      </div>

      {/* Status LED */}
      <div className="absolute z-30 top-6 right-5 flex items-center gap-1.5">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
        </span>
        <span className="text-[9px] font-black uppercase tracking-wider text-emerald-300">printing</span>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Comparison data — Traditional vs PrintX                             */
/* ------------------------------------------------------------------ */
const COMPARISON = [
  {
    trad: 'Files arrive over WhatsApp — download each one by hand, all day',
    px: 'Customer-uploaded files route to your queue in 0 seconds',
    win: '0-second routing',
  },
  {
    trad: 'Long counter queues while one person juggles PC, cash-box, and phone',
    px: 'Customers self-serve from their phone — the queue lives on the screen',
    win: 'Zero queue',
  },
  {
    trad: '“Change nahi hai” — loose-change math and manual UPI checking',
    px: 'Dynamic UPI QR locked to the exact bill, soundbox-style instant confirmation',
    win: 'Instant UPI',
  },
  {
    trad: 'Sit and click Print for every single job, one file at a time',
    px: 'Silent background auto-print with multi-printer routing — you just hand over pages',
    win: 'Auto-print',
  },
  {
    trad: 'Customers install shareit / WhatsApp just to hand you one PDF',
    px: 'No app install — the counter QR opens the upload page in any phone camera',
    win: 'No app needed',
  },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0B132B] text-slate-100 overflow-x-hidden">
      {/* ============================ NAV ============================ */}
      <header className="sticky top-0 z-40 border-b border-[#1E2D4A]/60 bg-[#0B132B]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <PrintXLogo variant="full" size="md" />
          <nav className="flex items-center gap-2 sm:gap-3">
            <a
              href="/login"
              className="text-xs font-bold text-slate-300 hover:text-white px-3 py-2 rounded-lg hover:bg-white/5 transition-colors inline-flex items-center gap-1.5"
            >
              <LogIn className="w-3.5 h-3.5" />
              Vendor Login
            </a>
            <a
              href="/signup"
              className="text-xs font-black px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_16px_rgba(6,182,212,0.35)] hover:brightness-110 transition inline-flex items-center gap-1.5"
            >
              <Store className="w-3.5 h-3.5" />
              Register Your Shop
            </a>
          </nav>
        </div>
      </header>

      {/* ============================ HERO ============================ */}
      <section className="relative">
        {/* Ambient glows */}
        <div aria-hidden="true" className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[460px] rounded-full opacity-70 blur-3xl bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.16),transparent_65%)]" />
        <div aria-hidden="true" className="pointer-events-none absolute top-40 -right-40 w-96 h-96 rounded-full opacity-50 blur-3xl bg-[radial-gradient(ellipse_at_center,rgba(37,99,235,0.14),transparent_65%)]" />

        <div className="relative max-w-6xl mx-auto px-4 pt-16 pb-20 lg:pt-24">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Copy */}
            <div>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="inline-flex items-center gap-2 text-[11px] font-bold px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300"
              >
                <Zap className="w-3.5 h-3.5" />
                The Zero-Wait Counter Revolution
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="mt-5 text-4xl sm:text-5xl lg:text-[3.4rem] font-black leading-[1.08] tracking-tight"
              >
                <span className="bg-gradient-to-r from-cyan-300 via-cyan-400 to-blue-500 bg-clip-text text-transparent">
                  Smart Printing
                </span>
                <br />
                <span className="text-white">for Modern Xerox</span>
                <br />
                <span className="text-white">& Print Shops</span>
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22 }}
                className="mt-5 text-slate-400 text-lg leading-relaxed max-w-lg"
              >
                <span className="text-slate-200 font-semibold">Zero queues.</span> Instant WhatsApp
                notifications. Automatic printing — your counter runs itself while customers
                scan, upload, and pay.
              </motion.p>

              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.28 }}
                className="mt-3 text-sm font-bold italic text-cyan-200/90"
              >
                Dukan Chale Aapki, Print Kare PrintX.
              </motion.p>

              {/* CTAs */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.34 }}
                className="mt-8 flex flex-wrap items-center gap-3"
              >
                <a
                  href="/signup"
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-black shadow-[0_0_24px_rgba(6,182,212,0.4)] hover:shadow-[0_0_32px_rgba(6,182,212,0.55)] hover:brightness-110 transition"
                >
                  <Store className="w-4 h-4" />
                  Register Your Shop
                </a>
                <a
                  href="/s/sharma_xerox"
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-white/5 border border-[#1E2D4A] text-slate-100 text-sm font-bold hover:bg-white/10 hover:border-cyan-500/40 transition"
                >
                  <QrCode className="w-4 h-4 text-cyan-400" />
                  Try Live Demo
                </a>
                <a
                  href="/login"
                  className="inline-flex items-center gap-2 px-5 py-3.5 text-sm font-bold text-slate-300 hover:text-white transition-colors"
                >
                  Vendor Login
                  <ArrowRight className="w-4 h-4" />
                </a>
              </motion.div>

              {/* Trust strip */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="mt-8 flex items-center gap-5 text-[11px] text-slate-500"
              >
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> UPI-secured payments
                </span>
                <span className="flex items-center gap-1.5">
                  <BellRing className="w-3.5 h-3.5 text-amber-400" /> WhatsApp alerts
                </span>
                <span className="flex items-center gap-1.5">
                  <Printer className="w-3.5 h-3.5 text-cyan-400" /> Auto-print engine
                </span>
              </motion.div>
            </div>

            {/* Showcase cards */}
            <div className="relative flex justify-center lg:justify-end items-start gap-4 lg:gap-6 pb-6">
              <Printer3DStack />
              <div className="mt-10">
                <QrScannerCard />
              </div>
              <LiveTokenCard />
              {/* Floating printer chip */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.75, type: 'spring', stiffness: 240, damping: 18 }}
                className="absolute -bottom-2 left-2 lg:left-10 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-[#152238] px-3 py-2 shadow-xl"
              >
                <span className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                  <Printer className="w-4 h-4 text-emerald-400" />
                </span>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Auto-Print</div>
                  <div className="text-xs font-black text-emerald-300">ON · 97% ink</div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================ FEATURES ============================ */}
      <section className="relative border-t border-[#1E2D4A]/60 bg-[#0A111C]">
        <div className="max-w-6xl mx-auto px-4 py-20">
          <motion.h2
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            className="text-3xl font-black text-white tracking-tight text-center"
          >
            Everything your counter needs
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-slate-400 text-center mt-3 max-w-xl mx-auto"
          >
            One QR code replaces the pen-drive queue, the WhatsApp file flood, and the cash-box math.
          </motion.p>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <FeatureCard
              delay={0}
              icon={<ScanLine className="w-6 h-6" />}
              emoji="📲"
              title="Scan & Upload"
              desc="Customers scan the counter QR and upload PDFs or photos — no app download, no login, no pen-drives."
              tone="cyan"
            />
            <FeatureCard
              delay={0.08}
              icon={<Printer className="w-6 h-6" />}
              emoji="🖨️"
              title="Auto-Print Engine"
              desc="Jobs print in the background the moment they arrive, with multi-printer routing for busy counters."
              tone="emerald"
            />
            <FeatureCard
              delay={0.16}
              icon={<Smartphone className="w-6 h-6" />}
              emoji="⚡"
              title="Instant UPI Payments"
              desc="Dynamic QR locked to the exact bill amount — GPay, PhonePe, Paytm — with soundbox-style verification."
              tone="amber"
            />
            <FeatureCard
              delay={0.24}
              icon={<BarChart3 className="w-6 h-6" />}
              emoji="📊"
              title="Smart Analytics"
              desc="Daily revenue, B&W vs color mix, rush-hour peaks, and subscription controls for every branch."
              tone="purple"
            />
          </div>
        </div>
      </section>

      {/* ====================== WHY PRINTX (COMPARISON) ====================== */}
      <section className="relative border-t border-[#1E2D4A]/60">
        <div className="max-w-6xl mx-auto px-4 py-20">
          <motion.h2
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            className="text-3xl font-black text-white tracking-tight text-center"
          >
            Why PrintX is better
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-slate-400 text-center mt-3 max-w-xl mx-auto"
          >
            Same counter, same customers — a completely different machine underneath.
          </motion.p>

          <div className="mt-12 grid md:grid-cols-2 gap-4 lg:gap-6">
            {/* Traditional */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ type: 'spring', stiffness: 200, damping: 24 }}
              className="rounded-2xl border border-slate-700/50 bg-[#0F1A2E]/80 p-6"
            >
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-slate-500/10 border border-slate-600/40 flex items-center justify-center">
                  <Store className="w-5 h-5 text-slate-400" />
                </span>
                <div>
                  <h3 className="text-sm font-black text-slate-300">Traditional Xerox Shop</h3>
                  <p className="text-[11px] text-slate-500">How it runs today</p>
                </div>
              </div>
              <ul className="mt-5 space-y-3">
                {COMPARISON.map((row) => (
                  <li key={row.trad} className="flex items-start gap-2.5 text-xs text-slate-400">
                    <XCircle className="w-4 h-4 shrink-0 text-red-400/70 mt-0.5" />
                    <span>{row.trad}</span>
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* PrintX */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ type: 'spring', stiffness: 200, damping: 24 }}
              className="relative rounded-2xl border border-cyan-500/30 bg-gradient-to-b from-[#12304A]/60 to-[#0F2438]/80 p-6 shadow-[0_0_36px_rgba(6,182,212,0.12)]"
            >
              <span className="absolute -top-3 right-5 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white shadow-lg">
                <Sparkles className="w-3 h-3" />
                Smart Counter
              </span>
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-cyan-500/12 border border-cyan-500/30 flex items-center justify-center">
                  <Printer className="w-5 h-5 text-cyan-300" />
                </span>
                <div>
                  <h3 className="text-sm font-black text-white">PrintX Smart Counter</h3>
                  <p className="text-[11px] text-cyan-300/80">How it runs with PrintX</p>
                </div>
              </div>
              <ul className="mt-5 space-y-3">
                {COMPARISON.map((row) => (
                  <li key={row.px} className="flex items-start gap-2.5 text-xs text-slate-200">
                    <Check className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                    <span>
                      {row.px}
                      {row.win && (
                        <span className="ml-2 inline-block rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-300">
                          {row.win}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>

          {/* Mid-page conversion strip */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-8 flex flex-wrap items-center justify-center gap-3 text-xs text-slate-400"
          >
            <Layers className="w-4 h-4 text-cyan-400" />
            Switch without stopping the counter — your first day on PrintX runs parallel to the old way.
            <a href="/signup" className="inline-flex items-center gap-1.5 font-black text-cyan-300 hover:text-cyan-200 transition-colors">
              Start free <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </motion.div>
        </div>
      </section>

      {/* ============================ HOW IT WORKS ============================ */}
      <section className="relative border-t border-[#1E2D4A]/60">
        <div className="max-w-6xl mx-auto px-4 py-20">
          <motion.h2
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            className="text-3xl font-black text-white tracking-tight text-center"
          >
            How it works
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-slate-400 text-center mt-3"
          >
            From scan to printed page in under a minute.
          </motion.p>

          <div className="mt-14 grid md:grid-cols-3 gap-6 relative">
            {/* Connector line (desktop) */}
            <div aria-hidden="true" className="hidden md:block absolute top-16 left-[18%] right-[18%] h-px bg-gradient-to-r from-cyan-500/40 via-blue-500/40 to-emerald-500/40" />

            <StepCard
              n={1}
              icon={<QrCode className="w-7 h-7" />}
              title="Customer scans the QR"
              desc="A sticker at the counter opens your shop's upload page — no app install, works on any phone camera."
              visual={
                <div className="mx-auto w-24 h-24 rounded-xl bg-white p-2">
                  <QRCodeSVG value="https://printx.in/s/sharma_xerox" size={88} fgColor="#0B132B" />
                </div>
              }
            />
            <StepCard
              n={2}
              icon={<Smartphone className="w-7 h-7" />}
              title="Upload & pay via UPI"
              desc="They pick B&W or color per file, see the live bill, and pay on a dynamic UPI QR — or choose cash at counter."
              visual={
                <div className="mx-auto flex items-center gap-2">
                  <div className="rounded-xl border border-[#1E2D4A] bg-[#152238] px-3 py-2.5 text-center">
                    <FileText className="w-5 h-5 text-cyan-400 mx-auto" />
                    <div className="text-[10px] text-slate-400 mt-1 font-semibold">notes.pdf</div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-600" />
                  <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-center">
                    <div className="text-sm font-black text-emerald-300">₹36</div>
                    <div className="text-[10px] text-emerald-400/80 font-semibold">UPI · Paid</div>
                  </div>
                </div>
              }
            />
            <StepCard
              n={3}
              icon={<Printer className="w-7 h-7" />}
              title="Chime & auto-print"
              desc="Your console chimes, the job auto-prints, and WhatsApp tells the customer their pages are ready."
              visual={
                <div className="mx-auto flex items-center justify-center gap-3">
                  <span className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
                    <Volume2 className="w-5 h-5 text-amber-400" />
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-600" />
                  <span className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
                    <Check className="w-5 h-5 text-emerald-400" />
                  </span>
                </div>
              }
            />
          </div>

          {/* Bottom CTA */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-16 rounded-3xl border border-cyan-500/25 bg-gradient-to-r from-[#0F172A] via-[#152238] to-[#0F172A] p-8 sm:p-10 text-center relative overflow-hidden"
          >
            <div aria-hidden="true" className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-40 rounded-full blur-3xl bg-cyan-500/15" />
            <h3 className="relative text-2xl font-black text-white tracking-tight">
              Ready to retire the pen-drive queue?
            </h3>
            <p className="relative text-slate-400 text-sm mt-2">
              Set up your shop in two minutes — free plan, no card required.
            </p>
            <div className="relative mt-6 flex flex-wrap justify-center gap-3">
              <a
                href="/signup"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-black shadow-[0_0_24px_rgba(6,182,212,0.4)] hover:brightness-110 transition"
              >
                <Store className="w-4 h-4" />
                Register Your Shop
              </a>
              <a
                href="/s/sharma_xerox"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/5 border border-[#1E2D4A] text-slate-100 text-sm font-bold hover:bg-white/10 transition"
              >
                <QrCode className="w-4 h-4 text-cyan-400" />
                Try Live Demo
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ============================ FOOTER ============================ */}
      <footer className="border-t border-[#1E2D4A]/60 bg-[#0A111C]">
        <div className="max-w-6xl mx-auto px-4 py-12">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex flex-col items-center sm:items-start gap-2">
              <PrintXLogo variant="full" size="md" />
              <p className="text-xs text-slate-500">Smart printing for modern print shops.</p>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/8 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300/90">
                <Sparkles className="w-3 h-3" />
                Powered by QRKraft
              </span>
            </div>
            <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-bold text-slate-400">
              <a href="/login" className="hover:text-cyan-300 transition-colors">Login</a>
              <a href="/signup" className="hover:text-cyan-300 transition-colors">Signup</a>
              <a href="/admin/dashboard" className="hover:text-purple-300 transition-colors">Admin Portal</a>
              <a href="mailto:hello@printx.in" className="hover:text-cyan-300 transition-colors inline-flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" />
                Support
              </a>
            </nav>
          </div>
          <div className="mt-8 pt-6 border-t border-[#1E2D4A]/60 text-center text-[11px] text-slate-600">
            © {new Date().getFullYear()} PrintX · Fast & secure printing · hello@printx.in
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

const TONES = {
  cyan: 'bg-cyan-500/12 border-cyan-500/30 text-cyan-300',
  emerald: 'bg-emerald-500/12 border-emerald-500/30 text-emerald-300',
  amber: 'bg-amber-500/12 border-amber-500/30 text-amber-300',
  purple: 'bg-purple-500/12 border-purple-500/30 text-purple-300',
};

function FeatureCard({ icon, emoji, title, desc, tone, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ delay, type: 'spring', stiffness: 220, damping: 24 }}
      whileHover={{ y: -4 }}
      className="rounded-2xl border border-[#1E2D4A] bg-[#152238]/70 p-5 hover:border-slate-600/70 transition-colors"
    >
      <div className={`w-12 h-12 rounded-xl border flex items-center justify-center relative ${TONES[tone]}`}>
        {icon}
        <span className="absolute -top-2 -right-2 text-sm" aria-hidden="true">{emoji}</span>
      </div>
      <h3 className="mt-4 text-sm font-black text-white">{title}</h3>
      <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">{desc}</p>
    </motion.div>
  );
}

function StepCard({ n, icon, title, desc, visual }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ delay: (n - 1) * 0.1, type: 'spring', stiffness: 220, damping: 24 }}
      className="relative rounded-2xl border border-[#1E2D4A] bg-[#152238]/70 p-6 text-center"
    >
      <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 text-cyan-300 flex items-center justify-center relative z-10">
        {icon}
        <span className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-cyan-500 text-[#0B132B] text-xs font-black flex items-center justify-center shadow-lg">
          {n}
        </span>
      </div>
      <h3 className="mt-4 text-sm font-black text-white">{title}</h3>
      <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">{desc}</p>
      <div className="mt-5">{visual}</div>
    </motion.div>
  );
}
