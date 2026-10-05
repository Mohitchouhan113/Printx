/**
 * Resolution hook so probe scripts can import the app's own modules.
 *
 * The Next.js app uses bundler-style extensionless relative imports
 * (`./supabaseAdmin`), which plain Node ESM refuses to resolve. This retries a
 * failed relative resolution with the extensions the bundler would have tried.
 *
 * Usage: node --import ./scripts/ext-loader.mjs <script>
 */
import { registerHooks } from 'node:module';

const EXTS = ['.js', '.jsx', '.mjs', '/index.js'];

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      const isRelative = specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:');
      if (!isRelative) throw err;
      for (const ext of EXTS) {
        try {
          return nextResolve(specifier + ext, context);
        } catch {
          /* try the next extension */
        }
      }
      throw err;
    }
  },
});
