'use client';

/**
 * PrintX Theme Toggle
 * Floating sun-moon toggle with Framer Motion rotation & scale
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle({ className = '', size = 'md' }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className={`${getSizeClasses(size)} ${className}`} />
    );
  }

  const isDark = theme === 'dark';
  
  const toggleTheme = () => {
    setTheme(isDark ? 'light' : 'dark');
  };

  return (
    <motion.button
      onClick={toggleTheme}
      className={`
        relative flex items-center justify-center rounded-full
        bg-white dark:bg-dark-accent 
        shadow-card dark:shadow-dark-card
        hover:shadow-card-hover dark:hover:shadow-dark-glow
        transition-all duration-300
        ${getSizeClasses(size)}
        ${className}
      `}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.div
            key="moon"
            initial={{ rotate: -90, scale: 0, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: 90, scale: 0, opacity: 0 }}
            transition={{ 
              duration: 0.3, 
              ease: [0.4, 0, 0.2, 1] 
            }}
            className="absolute"
          >
            <Moon className={`${getIconClasses(size)} text-primary-400`} />
          </motion.div>
        ) : (
          <motion.div
            key="sun"
            initial={{ rotate: 90, scale: 0, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: -90, scale: 0, opacity: 0 }}
            transition={{ 
              duration: 0.3, 
              ease: [0.4, 0, 0.2, 1] 
            }}
            className="absolute"
          >
            <Sun className={`${getIconClasses(size)} text-amber-500`} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function getSizeClasses(size) {
  switch (size) {
    case 'sm':
      return 'w-8 h-8';
    case 'md':
      return 'w-10 h-10';
    case 'lg':
      return 'w-12 h-12';
    default:
      return 'w-10 h-10';
  }
}

function getIconClasses(size) {
  switch (size) {
    case 'sm':
      return 'w-4 h-4';
    case 'md':
      return 'w-5 h-5';
    case 'lg':
      return 'w-6 h-6';
    default:
      return 'w-5 h-5';
  }
}
