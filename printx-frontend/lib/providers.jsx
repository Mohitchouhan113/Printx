'use client';

/**
 * PrintX Theme Provider (JavaScript)
 * Wraps the app with next-themes ThemeProvider
 */

import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({ children }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem={true}
      disableTransitionOnChange={false}
    >
      {children}
    </NextThemesProvider>
  );
}

export default ThemeProvider;
