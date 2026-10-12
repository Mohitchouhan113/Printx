/**
 * @deprecated Use lib/soundbox.js instead — this file is kept only for
 * backward compatibility during the migration. All new code should import
 * from soundbox.js which provides the guaranteed Web Audio beep + Speech
 * Synthesis fallback.
 */

import { speakOrderAlert, primeVoices } from './soundbox.js';
export { speakOrderAlert, primeVoices };

