/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Gzip for every text response (Next.js default, pinned explicitly here
  // so low-bandwidth tuning can't silently regress). Brotli is NOT enabled:
  // Node's zlib can produce it, but Next's built-in compression middleware
  // doesn't negotiate it — flipping this on would only add dead config.
  // Terminate TLS at a CDN/Nginx/Caddy in production and brotli comes free
  // with `brotli on;` there.
  compress: true,
  // Never ship source maps to customers on metered connections.
  productionBrowserSourceMaps: false,
  images: {
    domains: ['localhost'],
    unoptimized: true,
  },
  // Transpile pdfjs-dist for Next.js
  transpilePackages: ['pdfjs-dist'],
  // Load pdf-parse natively in Node (route: /api/whatsapp/webhook).
  // Bundling it drags pdf-parse's NESTED pdfjs-dist legacy .mjs through
  // webpack's harmony interop, which crashes with "Object.defineProperty
  // called on non-object" — externalizing fixes it (plain-Node path is
  // already proven: getText().total counts pages).
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse'],
  },
  webpack: (config, { isServer }) => {
    // Handle pdf.js worker
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'pdfjs-dist': 'pdfjs-dist/build/pdf.mjs',
      };
    }
    return config;
  },
}

module.exports = nextConfig
