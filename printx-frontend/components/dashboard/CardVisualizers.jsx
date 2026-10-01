'use client';

import React from 'react';
import { motion } from 'framer-motion';

/*
 * Analytics-card visualizers — extracted from the vendor dashboard page so
 * they load as their own chunk (next/dynamic, ssr:false) instead of padding
 * the initial dashboard bundle. Pure presentational SVG.
 */
export default function CardVisualizer({ type, count = 0, efficiency = 100 }) {
  if (type === 'sparkline') return <Sparkline />;
  if (type === 'ratio') return <RatioBar />;
  if (type === 'pulse') return <PulseBar count={count} />;
  if (type === 'bars') return <MiniBars efficiency={efficiency} />;
  return null;
}

function Sparkline() {
  // Mini green sparkline — revenue trend
  const pts = '0,26 12,22 24,24 36,17 48,19 60,12 72,14 84,7 96,9 108,3';
  return (
    <div className="h-9 w-full rounded-lg bg-emerald-500/5 border border-emerald-500/10 overflow-hidden">
      <svg viewBox="0 0 108 29" preserveAspectRatio="none" className="w-full h-full">
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(16,185,129,0.35)" />
            <stop offset="100%" stopColor="rgba(16,185,129,0)" />
          </linearGradient>
        </defs>
        <polygon points={`${pts} 108,29 0,29`} fill="url(#sparkFill)" />
        <polyline points={pts} fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function RatioBar() {
  // B&W vs Color ratio — 80/20
  return (
    <div>
      <div className="h-2.5 w-full rounded-full bg-blue-500/80 overflow-hidden flex">
        <div className="h-full bg-blue-500" style={{ width: '80%' }} />
        <div className="h-full bg-indigo-400" style={{ width: '20%' }} />
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[10px] font-semibold">
        <span className="text-blue-400">80% B&amp;W</span>
        <span className="text-indigo-300">20% Color</span>
      </div>
    </div>
  );
}

function PulseBar({ count = 0 }) {
  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`h-6 flex-1 rounded-md border animate-pulse ${
            count > 0
              ? 'bg-amber-500/25 border-amber-500/30'
              : 'bg-slate-800/40 border-slate-700/40'
          }`}
          style={{ animationDelay: `${i * 0.3}s` }}
        />
      ))}
      <span className={`text-[10px] font-bold ml-1 ${count > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
        {count} in queue
      </span>
    </div>
  );
}

function MiniBars({ efficiency = 100 }) {
  // Printer efficiency trend bars — recent prints climb toward the live
  // efficiency value instead of a hardcoded [88, 92, 96, 97].
  const bars = [efficiency - 12, efficiency - 8, efficiency - 4, efficiency].map((v) =>
    Math.max(0, Math.min(100, v))
  );
  return (
    <div className="space-y-1.5">
      {bars.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${v}%` }}
              transition={{ delay: 0.3 + i * 0.1, duration: 0.6 }}
              className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-400"
            />
          </div>
          <span className="text-[10px] font-bold text-teal-300 w-8 text-right">{v}%</span>
        </div>
      ))}
    </div>
  );
}
