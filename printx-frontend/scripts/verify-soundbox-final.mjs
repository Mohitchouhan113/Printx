import { setTimeout as setMs } from 'node:timers';

const fakeWindow = {
  AudioContext: class {
    constructor() { this.currentTime = 0; }
    createOscillator() {
      return {
        type: '',
        frequency: { setValueAtTime: () => {} },
        connect: () => {},
        start: () => {},
        stop: () => {},
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        connect: () => {},
      };
    }
  },
  webkitAudioContext: undefined,
  SpeechSynthesisUtterance: class {},
  speechSynthesis: {
    cancel: () => {},
    speak: () => {},
    getVoices: () => [{ lang: 'hi-IN', name: 'Google Hindi' }],
    addEventListener: () => {},
  },
  localStorage: { getItem: () => null, setItem: () => {} },
};

const origWindow = globalThis.window;
Object.defineProperty(globalThis, 'window', {
  value: fakeWindow,
  writable: true,
  configurable: true,
});
globalThis.SpeechSynthesisUtterance = fakeWindow.SpeechSynthesisUtterance;

const modulePath = 'file:///C:/Users/mohit/OneDrive/Desktop/PrintX/printx-frontend/lib/soundbox.js';

await import(modulePath);

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  if (actual === expected) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}: got ${actual}, expected ${expected}`);
    failed++;
  }
}

// Test 1: triggerSoundboxAlert({ token: '7' })
{
  console.log('Test 1: triggerSoundboxAlert({ token: "7" })');
  const speakCalls = [];
  fakeWindow.speechSynthesis.speak = function (msg) {
    // msg is a SpeechSynthesisUtterance instance — read its text property
    // which the soundbox module sets via the constructor.
    const text = msg?.text;
    speakCalls.push(text);
    console.log('    DEBUG speak called, msg.text:', JSON.stringify(text));
  };
  fakeWindow.triggerSoundboxAlert({ token: '7' });
  await new Promise((r) => setMs(r, 400));
  check('speak called exactly once', speakCalls.length, 1);
  check('correct Hindi phrase', speakCalls[0], 'Naya order aaya hai, token number 7');
}

// Test 2: triggerSoundboxAlert({ order: { token_no: 42 } })
{
  console.log('Test 2: triggerSoundboxAlert({ order: { token_no: 42 } })');
  const speakCalls = [];
  fakeWindow.speechSynthesis.speak = function (msg) {
    const text = msg?.text;
    speakCalls.push(text);
    console.log('    DEBUG speak called, msg.text:', JSON.stringify(text));
  };
  fakeWindow.triggerSoundboxAlert({ order: { token_no: 42 } });
  await new Promise((r) => setMs(r, 400));
  check('speak called exactly once', speakCalls.length, 1);
  check('correct Hindi phrase from order shape', speakCalls[0], 'Naya order aaya hai, token number 42');
}

// Test 3: soundbox disabled
{
  console.log('Test 3: soundbox disabled (localStorage returns "false")');
  const OrigAudioCtx = fakeWindow.AudioContext;
  let beepCount = 0;
  fakeWindow.AudioContext = class extends OrigAudioCtx {
    constructor() {
      super();
      beepCount++;
    }
  };
  fakeWindow.localStorage.getItem = () => 'false';
  fakeWindow.speechSynthesis.speak = () => {
    console.log('  ✗ speak should not be called when disabled');
  };
  fakeWindow.triggerSoundboxAlert({ token: '99' });
  check('no beep when disabled', beepCount, 0);
  fakeWindow.AudioContext = OrigAudioCtx;
  fakeWindow.localStorage.getItem = () => null;
}

// Test 4: speakOrderAlert standalone
{
  console.log('Test 4: speakOrderAlert("32")');
  const speakCalls = [];
  fakeWindow.speechSynthesis.speak = (msg) => {
    // msg is a SpeechSynthesisUtterance instance — read its text property
    // which the soundbox module sets via the constructor.
    const text = msg?.text;
    speakCalls.push(text);
  };
  const result = fakeWindow.speakOrderAlert('32');
  check('returns true', result, true);
  check('correct phrase', speakCalls[0], 'Naya order aaya hai, token number 32');
}

// Test 5: speakOrderAlert with old order shape
{
  console.log('Test 5: speakOrderAlert({ token_no: 5 })');
  const speakCalls = [];
  fakeWindow.speechSynthesis.speak = (msg) => {
    // msg is a SpeechSynthesisUtterance instance — read its text property
    // which the soundbox module sets via the constructor.
    const text = msg?.text;
    speakCalls.push(text);
  };
  const result = fakeWindow.speakOrderAlert({ token_no: 5 });
  check('returns true', result, true);
  check('correct phrase from order shape', speakCalls[0], 'Naya order aaya hai, token number 5');
}

// Restore
Object.defineProperty(globalThis, 'window', {
  value: origWindow,
  writable: true,
  configurable: true,
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
