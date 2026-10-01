'use client';

import React from 'react';

/**
 * PrintXLogo — geometric layered "X" SVG logo.
 *
 * Props:
 *   variant  — "full" (icon + "PrintX" text) | "icon-only" (just the X symbol)
 *   size     — "sm" (24px) | "md" (32px) | "lg" (48px)
 *   className — custom Tailwind classes
 */

const SIZES = {
  sm: { icon: 24, text: 'text-lg', gap: 'gap-1.5' },
  md: { icon: 32, text: 'text-xl', gap: 'gap-2' },
  lg: { icon: 48, text: 'text-3xl', gap: 'gap-3' },
};

export default function PrintXLogo({ variant = 'full', size = 'md', className = '' }) {
  const s = SIZES[size] || SIZES.md;

  return (
    <span className={`inline-flex items-center ${s.gap} ${className}`}>
      <GeometricX size={s.icon} />
      {variant === 'full' && (
        <span className={`font-black tracking-tight text-white ${s.text}`}>
          Print<span className="text-[#FF3B30]">X</span>
        </span>
      )}
    </span>
  );
}

/**
 * GeometricX — the standalone layered X symbol.
 *
 * The design is a geometric shape made of overlapping chevron/arrow forms
 * creating a bold, modern X mark. Electric Red/Orange (#FF3B30).
 */
function GeometricX({ size = 32 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="PrintX logo"
      role="img"
    >
      {/* Top-left to bottom-right chevron (back layer) */}
      <path
        d="M32 8 L56 32 L32 56 L8 32 Z"
        fill="none"
        stroke="#FF3B30"
        strokeWidth="3"
        strokeLinejoin="round"
      />

      {/* Inner diamond */}
      <path
        d="M32 16 L48 32 L32 48 L16 32 Z"
        fill="#FF3B30"
        fillOpacity="0.25"
        stroke="#FF3B30"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* Central X cross — bold diagonal lines */}
      <line x1="18" y1="18" x2="46" y2="46" stroke="#FF3B30" strokeWidth="4" strokeLinecap="round" />
      <line x1="46" y1="18" x2="18" y2="46" stroke="#FF3B30" strokeWidth="4" strokeLinecap="round" />

      {/* Top chevron accent */}
      <path
        d="M24 12 L32 6 L40 12"
        fill="none"
        stroke="#FF3B30"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Bottom chevron accent */}
      <path
        d="M24 52 L32 58 L40 52"
        fill="none"
        stroke="#FF3B30"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Left chevron accent */}
      <path
        d="M12 24 L6 32 L12 40"
        fill="none"
        stroke="#FF3B30"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Right chevron accent */}
      <path
        d="M52 24 L58 32 L52 40"
        fill="none"
        stroke="#FF3B30"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Center dot */}
      <circle cx="32" cy="32" r="3" fill="#FF3B30" />
    </svg>
  );
}

/**
 * PrintXFavicon — standalone icon for browser tab favicon.
 * Returns just the SVG markup as a string for next.config or icon route.
 */
export function PrintXFavicon({ size = 32 }) {
  return <GeometricX size={size} />;
}
