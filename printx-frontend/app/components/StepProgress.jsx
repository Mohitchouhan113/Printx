'use client';

/**
 * PrintX Step Progress Bar (JavaScript)
 * Visual indicator for multi-step flow
 */

import React from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

export default function StepProgress({ currentStep, steps }) {
  const currentIndex = steps.findIndex((s) => s.id === currentStep);

  return (
    <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-b border-gray-100 dark:border-slate-800 sticky top-0 z-50 transition-colors duration-300">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          {steps.map((step, index) => {
            const isCompleted = index < currentIndex;
            const isCurrent = index === currentIndex;

            return (
              <React.Fragment key={step.id}>
                {/* Step Circle */}
                <div className="flex flex-col items-center">
                  <motion.div
                    initial={false}
                    animate={{
                      scale: isCurrent ? 1.1 : 1,
                      backgroundColor: isCompleted
                        ? '#22c55e'
                        : isCurrent
                          ? '#2563eb'
                          : '#e5e7eb',
                    }}
                    className={`
                      w-8 h-8 rounded-full flex items-center justify-center
                      transition-colors duration-300
                      ${isCurrent ? 'shadow-glow dark:shadow-dark-glow' : ''}
                    `}
                  >
                    {isCompleted ? (
                      <Check className="w-4 h-4 text-white" />
                    ) : (
                      <span className={`text-sm font-medium ${
                        isCurrent ? 'text-white' : 'text-gray-500 dark:text-gray-400'
                      }`}>
                        {index + 1}
                      </span>
                    )}
                  </motion.div>
                  <span className={`text-xs mt-1 font-medium transition-colors duration-300 ${
                    isCurrent ? 'text-primary-600 dark:text-primary-400' : isCompleted ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'
                  }`}>
                    {step.label}
                  </span>
                </div>

                {/* Connector Line */}
                {index < steps.length - 1 && (
                  <div className="flex-1 h-0.5 mx-2 mb-4">
                    <div className="h-full bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden transition-colors duration-300">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{
                          width: isCompleted ? '100%' : isCurrent ? '50%' : '0%'
                        }}
                        transition={{ duration: 0.3 }}
                        className="h-full bg-primary-500"
                      />
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
