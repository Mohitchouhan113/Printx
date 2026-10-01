'use client';

/**
 * PrintX Step 3: Dynamic Print Configurator & Price Breakdown
 * Interactive controls with real-time price calculation
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Minus,
  Plus,
  Calculator,
  Sparkles,
  FileText,
  Layers,
  BookOpen,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// Binding prices
const BINDING_PRICES = {
  none: 0,
  stapler: 5,
  spiral: 20,
};

// Default shop rates (fallback if shop data unavailable)
const DEFAULT_RATES = {
  bw: 2,
  color: 5,
};

/**
 * Animated number counter
 */
function AnimatedNumber({ value }) {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const duration = 400;
    const start = display;
    const end = value;
    const startTime = Date.now();

    let rafId;
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (end - start) * eased);
      setDisplay(current);
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <span>₹{display}</span>;
}

export default function PrintSettings({
  analysis,
  shop,
  onProceed,
  onBack,
}) {
  // Shop rates (fall back to defaults)
  const rates = shop?.rates || DEFAULT_RATES;

  // Analysis data (from server scan)
  const totalPages = analysis?.total_pages ?? 1;
  const bwCount = analysis?.bw_pages_count ?? 1;
  const colorCount = analysis?.color_pages_count ?? 0;
  const colorPagesList = analysis?.color_pages_list ?? [];

  // Config state
  const [copies, setCopies] = useState(1);
  const [paperType, setPaperType] = useState('bw'); // 'bw' | 'color'
  const [doubleSided, setDoubleSided] = useState(false);
  const [binding, setBinding] = useState('none'); // 'none' | 'stapler' | 'spiral'

  // Pre-select paper type based on scan results
  useEffect(() => {
    if (colorCount > 0) {
      setPaperType('color');
    } else {
      setPaperType('bw');
    }
  }, [colorCount]);

  // Real-time price calculation
  // B&W Total = bw_pages × bw_rate × copies
  // Color Total = color_pages × color_rate × copies
  // Double-sided halves sheet count (pages still priced per page — sheet count shown for info)
  const pricing = useMemo(() => {
    // When double-sided, two page-sides share one sheet but xerox shops still
    // charge per printed page; keep per-page pricing, adjust only displayed sheets.
    const effectiveBw = paperType === 'color' ? bwCount : totalPages;
    const effectiveColor = paperType === 'color' ? colorCount : 0;

    const bwTotal = effectiveBw * rates.bw * copies;
    const colorTotal = effectiveColor * rates.color * copies;
    const bindingTotal = BINDING_PRICES[binding] * copies;

    const total = bwTotal + colorTotal + bindingTotal;

    const sheets = doubleSided
      ? Math.ceil(totalPages / 2) * copies
      : totalPages * copies;

    return { bwTotal, colorTotal, bindingTotal, total, sheets, effectiveBw, effectiveColor };
  }, [paperType, bwCount, colorCount, totalPages, rates, copies, binding, doubleSided]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100 }}
      transition={{ type: 'spring', damping: 25 }}
      className="min-h-screen bg-gradient-to-b from-blue-50 to-white dark:from-slate-900 dark:to-slate-900 p-4 transition-colors duration-300"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-xl bg-white dark:bg-slate-800 shadow-card dark:shadow-none flex items-center justify-center text-dark-navy dark:text-white transition-colors duration-300"
        >
          ←
        </button>
        <h1 className="text-lg font-semibold text-dark-navy dark:text-white transition-colors duration-300">
          Print Settings
        </h1>
        <ThemeToggle size="sm" />
      </div>

      {/* Document Analysis Summary Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-slate-800 rounded-3xl shadow-card dark:shadow-none p-5 mb-4 transition-colors duration-300"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900/50 rounded-xl flex items-center justify-center">
            <FileText className="w-6 h-6 text-primary-600 dark:text-primary-400" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-dark-navy dark:text-white truncate transition-colors duration-300">
              {analysis?.file_name || 'document.pdf'}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {analysis?.file_size_kb ? `${Number(analysis.file_size_kb).toFixed(2)} KB` : '—'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-surface-light dark:bg-slate-700 rounded-2xl p-3 text-center transition-colors duration-300">
            <div className="text-2xl font-bold text-dark-navy dark:text-white">{totalPages}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Total Pages</div>
          </div>
          <div className="bg-surface-light dark:bg-slate-700 rounded-2xl p-3 text-center transition-colors duration-300">
            <div className="text-2xl font-bold text-dark-navy dark:text-white">{bwCount}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">B&W Pages</div>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/30 rounded-2xl p-3 text-center transition-colors duration-300">
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{colorCount}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Color Pages</div>
          </div>
        </div>

        {colorPagesList.length > 0 && (
          <div className="mt-3 p-3 bg-purple-50 dark:bg-purple-900/30 rounded-xl">
            <div className="text-sm font-medium text-purple-700 dark:text-purple-300">
              🎨 Color pages: {colorPagesList.join(', ')}
            </div>
          </div>
        )}
      </motion.div>

      {/* Interactive Controls */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white dark:bg-slate-800 rounded-3xl shadow-card dark:shadow-none p-5 mb-4 transition-colors duration-300"
      >
        {/* Copies Counter */}
        <div className="mb-5">
          <label className="text-sm font-medium text-dark-navy dark:text-white mb-2 block transition-colors duration-300">
            Copies
          </label>
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setCopies((c) => Math.max(1, c - 1))}
              className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-slate-700 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-slate-600 transition-all active:scale-95"
            >
              <Minus className="w-5 h-5 text-dark-navy dark:text-white" />
            </button>
            <motion.div
              key={copies}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-20 h-12 bg-dark-navy dark:bg-white text-white dark:text-dark-navy rounded-xl flex items-center justify-center text-2xl font-bold transition-colors duration-300"
            >
              {copies}
            </motion.div>
            <button
              onClick={() => setCopies((c) => Math.min(99, c + 1))}
              className="w-12 h-12 rounded-xl bg-primary-600 text-white flex items-center justify-center hover:bg-primary-700 transition-all active:scale-95"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Paper Type */}
        <div className="mb-5">
          <label className="text-sm font-medium text-dark-navy dark:text-white mb-2 block transition-colors duration-300">
            Paper Type
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPaperType('bw')}
              className={`py-3 px-4 rounded-xl font-medium transition-all duration-300 ${
                paperType === 'bw'
                  ? 'bg-dark-navy dark:bg-white text-white dark:text-dark-navy shadow-lg'
                  : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
              }`}
            >
              <div className="text-lg mb-0.5">🖨️</div>
              <div className="text-sm">B&W · ₹{rates.bw}/page</div>
            </button>
            <button
              onClick={() => setPaperType('color')}
              className={`py-3 px-4 rounded-xl font-medium transition-all duration-300 ${
                paperType === 'color'
                  ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-lg'
                  : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
              }`}
            >
              <div className="text-lg mb-0.5">🎨</div>
              <div className="text-sm">Color · ₹{rates.color}/page</div>
            </button>
          </div>
        </div>

        {/* Sides */}
        <div className="mb-5">
          <label className="text-sm font-medium text-dark-navy dark:text-white mb-2 flex items-center gap-2 transition-colors duration-300">
            <Layers className="w-4 h-4" /> Sides
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setDoubleSided(false)}
              className={`py-3 px-4 rounded-xl font-medium text-sm transition-all duration-300 ${
                !doubleSided
                  ? 'bg-primary-600 text-white shadow-lg'
                  : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
              }`}
            >
              Single-Sided
            </button>
            <button
              onClick={() => setDoubleSided(true)}
              className={`py-3 px-4 rounded-xl font-medium text-sm transition-all duration-300 ${
                doubleSided
                  ? 'bg-primary-600 text-white shadow-lg'
                  : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
              }`}
            >
              Double-Sided
            </button>
          </div>
          {doubleSided && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <BookOpen className="w-3 h-3" /> Saves paper — {pricing.sheets} sheet{pricing.sheets !== 1 ? 's' : ''} needed
            </p>
          )}
        </div>

        {/* Binding Options */}
        <div>
          <label className="text-sm font-medium text-dark-navy dark:text-white mb-2 block transition-colors duration-300">
            Binding
          </label>
          <div className="grid grid-cols-3 gap-2">
            {['none', 'stapler', 'spiral'].map((option) => (
              <button
                key={option}
                onClick={() => setBinding(option)}
                className={`py-3 px-2 rounded-xl font-medium text-sm transition-all duration-300 ${
                  binding === option
                    ? 'bg-primary-600 text-white shadow-lg'
                    : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                }`}
              >
                <div>{option === 'none' ? 'None' : option === 'stapler' ? '📎 Stapler' : '📒 Spiral'}</div>
                <div className="text-xs opacity-80 mt-0.5">
                  {BINDING_PRICES[option] === 0 ? '₹0' : `+₹${BINDING_PRICES[option]}`}
                </div>
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Real-Time Price Calculation Card */}
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-gradient-to-br from-primary-600 to-primary-700 dark:from-primary-500 dark:to-primary-600 rounded-3xl shadow-glow p-5 mb-4"
        >
          <div className="flex items-center gap-2 mb-4">
            <Calculator className="w-5 h-5 text-white" />
            <h3 className="text-sm font-semibold text-white/90 uppercase tracking-wide">
              Price Breakdown
            </h3>
          </div>

          <div className="space-y-3">
            {/* B&W line */}
            <div className="flex items-center justify-between text-white">
              <span className="text-white/80">
                {pricing.effectiveBw} × ₹{rates.bw} × {copies}
              </span>
              <span className="font-semibold">{`₹${pricing.bwTotal}`}</span>
            </div>

            {/* Color line */}
            {pricing.effectiveColor > 0 && (
              <div className="flex items-center justify-between text-white">
                <span className="text-white/80">
                  {pricing.effectiveColor} × ₹{rates.color} × {copies}
                </span>
                <span className="font-semibold">{`₹${pricing.colorTotal}`}</span>
              </div>
            )}

            {/* Binding line */}
            {BINDING_PRICES[binding] > 0 && (
              <div className="flex items-center justify-between text-white">
                <span className="text-white/80 capitalize">
                  {binding} binding × {copies}
                </span>
                <span className="font-semibold">{`₹${pricing.bindingTotal}`}</span>
              </div>
            )}

            {/* Double-sided note */}
            {doubleSided && (
              <div className="text-xs text-white/60">
                Double-sided: {Math.ceil(totalPages / 2)} sheets per copy
              </div>
            )}
          </div>

          <div className="border-t border-white/20 my-4" />

          <div className="flex items-center justify-between">
            <span className="text-lg font-semibold text-white">Total</span>
            <div className="text-4xl font-bold text-white">
              <AnimatedNumber value={pricing.total} />
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* CTA */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="sticky bottom-4"
      >
        <button
          onClick={() => onProceed({ copies, paperType, doubleSided, binding, pricing })}
          className="w-full bg-gradient-to-r from-primary-600 to-primary-700 text-white font-semibold
                     py-4 px-6 rounded-2xl shadow-glow hover:shadow-glow-lg transition-all duration-300
                     flex items-center justify-center gap-2 active:scale-[0.98]"
        >
          <Sparkles className="w-5 h-5" />
          Proceed to Payment · ₹{pricing.total}
        </button>
      </motion.div>
    </motion.div>
  );
}
