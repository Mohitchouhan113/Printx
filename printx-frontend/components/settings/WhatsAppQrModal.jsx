'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';

/*
 * WhatsApp-linked-devices QR modal — extracted from ShopSettings so it can be
 * loaded on demand via next/dynamic (ssr:false). Rendered only when the
 * vendor taps "Link WhatsApp", keeping qrcode/QR chrome out of the initial
 * settings bundle.
 */
export default function WhatsAppQrModal({ open, waQr, onClose, onCheck }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="w-full max-w-sm bg-[#1E293B] border border-[#1E2D4A] rounded-2xl p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold text-sm">Scan QR with WhatsApp</h3>
              <button onClick={onClose} className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white">
                <span className="sr-only">Close</span>
                ×
              </button>
            </div>
            <div className="flex flex-col items-center gap-4">
              {waQr ? (
                <div className="bg-white p-4 rounded-xl">
                  <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(waQr)}`} alt="QR Code" className="w-48 h-48" />
                </div>
              ) : (
                <div className="w-48 h-48 bg-slate-800 rounded-xl flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                </div>
              )}
              <p className="text-[11px] text-slate-500 text-center">
                Open WhatsApp on your phone → Settings → Linked Devices → Link a Device
              </p>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => { onClose(); onCheck(); }}
                className="w-full px-4 py-2.5 rounded-xl bg-cyan-500/15 text-cyan-300 text-xs font-bold border border-cyan-500/30 hover:bg-cyan-500/25 transition-colors"
              >
                Check Connection
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
