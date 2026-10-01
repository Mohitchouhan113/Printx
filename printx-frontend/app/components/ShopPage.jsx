'use client';

/**
 * PrintX Shop Page — Step Orchestrator (1→2→3→4→5)
 * Order creation + WebSocket (PAYMENT_RECEIVED, ORDER_UPDATE) + live progress
 * Pure JavaScript (.jsx)
 */

import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import ShopLanding from './ShopLanding';
import UploadAnalysis from './UploadAnalysis';
import PrintSettings from './PrintSettings';
/* Payment modal (incl. QR/cash UPI UI) — loads only when the customer
 * reaches the payment step (ssr:false), keeping the upload flow lean. */
const PaymentModal = dynamic(() => import('./PaymentModal'), { ssr: false });
import TokenScreen from './TokenScreen';
import StepProgress from './StepProgress';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// Mock shop for demo/offline mode (never let the UI freeze)
const MOCK_SHOP = {
  shop_id: 'sdbc_xerox_01',
  name: 'Sharma Xerox (SDBC Campus)',
  owner_phone: '9876543210',
  rates: { bw: 2, color: 5, spiral: 20, stapler: 5 },
  address: { street: 'SDBC Campus, Main Road', city: 'Indore' },
  is_active: true,
  operating_hours: { open: '08:00', close: '22:00' },
  rating: 4.8,
  total_reviews: 124,
};

const STEPS = [
  { id: 'landing', label: 'Shop' },
  { id: 'upload', label: 'Upload' },
  { id: 'settings', label: 'Settings' },
  { id: 'payment', label: 'Pay' },
  { id: 'token', label: 'Token' },
];

export default function ShopPage({ shopId }) {
  const [step, setStep] = useState('landing');
  const [shop, setShop] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [config, setConfig] = useState(null);
  const [order, setOrder] = useState(null);
  const [tokenState, setTokenState] = useState({
    stage: 0,
    payment_id: null,
    order_status: null,
    payment_status: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load shop data (real or mock — never allow blocking)
  useEffect(() => {
    let cancelled = false;

    const loadShop = async () => {
      try {
        setIsLoading(true);
        const res = await axios.get(`${API_BASE}/api/shops/${shopId}`, { timeout: 3000 });
        if (!cancelled) setShop(res.data && res.data.data);
      } catch {
        if (!cancelled) setShop(MOCK_SHOP);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadShop();
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  // Step 2 completion — store the scanned analysis, move to Step 3
  const handleAnalysisComplete = useCallback(
    (result) => {
      setAnalysis(result);
      setStep('settings');
    },
    []
  );

  // Step 3 completion — store print config, move to Step 4
  const handleSettingsComplete = useCallback((settings) => {
    setConfig(settings);
    setStep('payment');
  }, []);

  // Step 4/5 bridge: any order payload (real API or simulated) lands here and advances to token screen.
  const handleOrderCreated = useCallback((orderData) => {
    setOrder(orderData);
    setStep('token');
  }, []);

  // Step 5: ORDER_UPDATE from socket — only advance stages when we are already on the token screen.
  const handleOrderUpdate = useCallback((update) => {
    const s = update.stage;
    if (s !== undefined) {
      setTokenState((prev) => ({ ...prev, stage: s, ...update }));
    } else {
      setTokenState((prev) => ({ ...prev, ...update }));
    }
  }, []);

  // Step 4: fallback/simulate success — create a fake order in local state & advance
  // (used by PaymentModal's "Simulate Payment Success (Dev Mode)" button)
  const handleSimulatePayment = useCallback(
    (orderData) => {
      const fakeOrder = {
        ...orderData,
        token_no: Number(orderData.token_no) || Math.floor(Math.random() * 99) + 1,
        payment_id: `PAY-DEV-${Date.now()}`,
        order_status: 'IN_PROGRESS',
        payment_status: 'PAID',
        created_at: new Date().toISOString(),
      };
      setOrder(fakeOrder);
      setStep('token');
    },
    []
  );

  // On payment success (websocket trigger), go to token screen and later simulate the rest
  const handlePaymentReceived = useCallback(
    (update) => {
      const merged = { ...order, ...update };
      setOrder(merged);
      // Start printing immediately after payment
      setTimeout(() => {
        setTokenState((prev) => ({ ...prev, stage: 1 }));
      }, 600);
      // Simulate "Ready for Pickup" after a short delay (demo flow)
      setTimeout(() => {
        setTokenState((prev) => ({ stage: 2, order_status: 'COMPLETED' }));
      }, 4500);
    },
    [order]
  );

  // Back button — always returns a step id (string), never a step id when already at landing.
  const goBack = useCallback(() => {
    if (step === 'payment') {
      setStep('settings');
      return;
    }
    if (step === 'token') {
      setStep('payment');
      return;
    }
    if (step === 'settings') {
      setStep('upload');
      return;
    }
    if (step === 'upload') {
      setStep('landing');
      return;
    }
  }, [step]);

  // Loading
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-blue-50 to-white dark:from-slate-900 dark:to-slate-900 transition-colors duration-300">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-12 h-12 border-4 border-primary-200 border-t-primary-600 rounded-full mx-auto mb-4"
          />
          <p className="text-gray-500 dark:text-gray-400">Loading shop...</p>
        </motion.div>
      </div>
    );
  }

  // Error
  if (error || (!shop && !isLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-blue-50 to-white dark:from-slate-900 dark:to-slate-900 transition-colors duration-300">
        <div className="text-center">
          <div className="text-6xl mb-4">😕</div>
          <h2 className="text-xl font-semibold text-dark-navy dark:text-white mb-2">Oops!</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-4">{error || 'Shop not found'}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-primary-600 dark:bg-primary-500 text-white rounded-xl font-medium hover:bg-primary-700 dark:hover:bg-primary-400 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white dark:from-slate-900 dark:to-slate-900 transition-colors duration-300">
      <StepProgress currentStep={step} steps={STEPS} />

      <AnimatePresence mode="wait">
        {step === 'landing' && (
          <ShopLanding key="landing" shop={shop} onProceed={() => setStep('upload')} />
        )}

        {step === 'upload' && (
          <UploadAnalysis
            key="upload"
            analysis={analysis}
            onAnalysisComplete={handleAnalysisComplete}
            onBack={goBack}
          />
        )}

        {step === 'settings' && analysis && (
          <PrintSettings
            key="settings"
            analysis={analysis}
            shop={shop}
            onProceed={handleSettingsComplete}
            onBack={goBack}
          />
        )}

        {step === 'payment' && (
          <PaymentModal
            key="payment"
            shop={shop}
            analysis={analysis}
            config={config}
            onComplete={handlePaymentReceived}
            onError={setError}
            onBack={goBack}
            onSimulate={handleSimulatePayment}
          />
        )}

        {step === 'token' && order && (
          <TokenScreen
            key="token"
            order={order}
            onOrderUpdate={handleOrderUpdate}
            onBack={goBack}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Step index lookup (used by StepProgress if you need numeric access)
export function stepIndex(stepId) {
  return STEPS.findIndex((s) => s.id === stepId);
}
