import '../styles/globals.css'
import { ThemeProvider } from '../lib/providers'
import MaintenanceGuard from '../components/MaintenanceGuard'
import ServiceWorkerRegistrar from '../components/ServiceWorkerRegistrar'

export const metadata = {
  title: 'PrintX - Smart Printing Platform',
  description: 'Smart web-based printing platform for local xerox shops',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#2563eb' },
    { media: '(prefers-color-scheme: dark)', color: '#3b82f6' },
  ],
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-surface-light dark:bg-dark-navy min-h-screen antialiased transition-colors duration-300">
        <ThemeProvider>
          <MaintenanceGuard>
            <main className="min-h-screen">
              {children}
            </main>
          </MaintenanceGuard>
        </ThemeProvider>
        {/* PWA offline shell — production-only (no-op under `npm run dev`) */}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  )
}
