'use client';

/**
 * PrintX Shop Landing Page (JavaScript)
 * Header with shop info, ratings, and quick rate card
 */

import React from 'react';
import { motion } from 'framer-motion';
import {
  MapPin,
  Star,
  Clock,
  Printer,
  ChevronRight
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export default function ShopLanding({ shop, onProceed }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="min-h-screen bg-gradient-to-b from-blue-50 to-white dark:from-slate-900 dark:to-slate-900 transition-colors duration-300"
    >
      {/* Hero Section */}
      <div className="relative bg-gradient-to-br from-primary-600 to-primary-700 text-white p-6 pb-24">
        <div className="absolute inset-0 bg-[url('/pattern.svg')] opacity-10" />

        {/* Theme Toggle - Top Right */}
        <div className="absolute top-4 right-4 z-20">
          <ThemeToggle size="sm" />
        </div>

        <div className="relative z-10">
          {/* Shop Image */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, type: 'spring' }}
            className="w-full h-48 rounded-3xl bg-white/20 backdrop-blur-sm mb-4 flex items-center justify-center"
          >
            <Printer className="w-20 h-20 text-white/80" />
          </motion.div>

          {/* Shop Info */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div className="flex items-start justify-between mb-2">
              <h1 className="text-2xl font-bold font-display">{shop.name}</h1>
              <span className="pulse-badge bg-green-400 text-green-900 text-xs font-semibold px-3 py-1 rounded-full">
                Open
              </span>
            </div>

            {/* Rating */}
            <div className="flex items-center gap-2 mb-3">
              <div className="flex items-center gap-1 bg-white/20 px-2 py-1 rounded-lg">
                <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                <span className="font-semibold">{shop.rating || 4.8}</span>
              </div>
              <span className="text-white/70 text-sm">
                ({shop.total_reviews || 124} reviews)
              </span>
            </div>

            {/* Location */}
            <div className="flex items-center gap-2 text-white/80">
              <MapPin className="w-4 h-4" />
              <span className="text-sm">
                {shop.address?.street || 'Geeta Bhawan'}, {shop.address?.city || 'Indore'}
              </span>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Content Cards */}
      <div className="relative -mt-16 px-4 space-y-4">
        {/* Quick Rate Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white dark:bg-slate-800 rounded-3xl shadow-card dark:shadow-none p-5 transition-colors duration-300"
        >
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Quick Rates
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-surface-light dark:bg-slate-700 rounded-2xl p-4 text-center transition-colors duration-300">
              <div className="text-3xl mb-1">🖨️</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">B&W</div>
              <div className="text-xl font-bold text-dark-navy dark:text-white">
                {formatCurrency(shop.rates.bw)}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-500">per page</div>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/30 dark:to-pink-900/30 rounded-2xl p-4 text-center transition-colors duration-300">
              <div className="text-3xl mb-1">🎨</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Color</div>
              <div className="text-xl font-bold text-purple-600 dark:text-purple-400">
                {formatCurrency(shop.rates.color)}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-500">per page</div>
            </div>
          </div>
        </motion.div>

        {/* Operating Hours */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-white dark:bg-slate-800 rounded-3xl shadow-card dark:shadow-none p-5 transition-colors duration-300"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/50 rounded-xl flex items-center justify-center transition-colors duration-300">
                <Clock className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <div className="font-semibold text-dark-navy dark:text-white transition-colors duration-300">Operating Hours</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {shop.operating_hours?.open || '08:00'} - {shop.operating_hours?.close || '22:00'}
                </div>
              </div>
            </div>
            <div className="text-green-500 dark:text-green-400 text-sm font-medium">Open Now</div>
          </div>
        </motion.div>

        {/* Binding Rates */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="bg-white dark:bg-slate-800 rounded-3xl shadow-card dark:shadow-none p-5 transition-colors duration-300"
        >
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Binding Options
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700/50 transition-colors duration-300">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/50 rounded-lg flex items-center justify-center text-sm transition-colors duration-300">
                  📒
                </div>
                <span className="font-medium text-dark-navy dark:text-white transition-colors duration-300">Spiral Binding</span>
              </div>
              <span className="font-bold text-dark-navy dark:text-white transition-colors duration-300">
                {formatCurrency(shop.rates.spiral)}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center text-sm transition-colors duration-300">
                  📎
                </div>
                <span className="font-medium text-dark-navy dark:text-white transition-colors duration-300">Stapler</span>
              </div>
              <span className="font-bold text-dark-navy dark:text-white transition-colors duration-300">
                {formatCurrency(shop.rates.stapler)}
              </span>
            </div>
          </div>
        </motion.div>

        {/* CTA Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="sticky bottom-4 pb-4"
        >
          <button
            onClick={onProceed}
            className="w-full bg-gradient-to-r from-primary-600 to-primary-700 dark:from-primary-500 dark:to-primary-600 text-white font-semibold
                       py-4 px-6 rounded-2xl shadow-glow hover:shadow-glow-lg transition-all duration-300
                       flex items-center justify-center gap-2 active:scale-[0.98]"
          >
            <span>Start Printing</span>
            <ChevronRight className="w-5 h-5" />
          </button>
        </motion.div>
      </div>
    </motion.div>
  );
}
