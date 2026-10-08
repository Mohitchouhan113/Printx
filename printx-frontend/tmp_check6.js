const fs = require('fs');
const S = fs.readFileSync('app/s/[slug]/page.jsx','utf8');

const startToken = 'const submitOrder = async (chosenPayment) => {';
const start = S.indexOf(startToken);
const open = S.indexOf('{', start);
const close = S.indexOf('};', start);
const submitBody = S.slice(open, close+2);

const apiUploadPositions = [];
let k = open;
while(k < close){
  const idx = S.indexOf('/api/upload', k);
  if(idx < 0 || idx > close) break;
  apiUploadPositions.push({ idx, before: S.slice(Math.max(open,idx-200), idx), after: S.slice(idx, idx+120) });
  k = idx + 11;
}

const fetchCallPositions = [];
k = open;
while(k < close){
  const idx = S.indexOf('fetch(', k);
  if(idx < 0 || idx > close) break;
  const window = S.slice(idx, idx+140);
  if(window.includes('/api/upload')){
    fetchCallPositions.push({ idx, window });
  }
  k = idx + 6;
}

const fetchWithRetryCallPositions = [];
k = open;
while(k < close){
  const idx = S.indexOf('fetchWithRetry(', k);
  if(idx < 0 || idx > close) break;
  const window = S.slice(idx, idx+140);
  if(window.includes('/api/upload')){
    fetchWithRetryCallPositions.push({ idx, window });
  }
  k = idx + 14;
}

console.log('api/upload substring hits in submitOrder body:', apiUploadPositions.length);
console.log('fetch( /api/upload call-like hits in submitOrder body:', fetchCallPositions.length);
console.log('fetchWithRetry( /api/upload call-like hits in submitOrder body:', fetchWithRetryCallPositions.length);

if(apiUploadPositions.length){
  console.log('api/upload contexts:', apiUploadPositions.map(h=>h.before+' || '+h.after));
}
if(fetchCallPositions.length){
  console.log('fetch( /api/upload contexts:', fetchCallPositions);
}
if(fetchWithRetryCallPositions.length){
  console.log('fetchWithRetry( /api/upload contexts:', fetchWithRetryCallPositions);
}

const onlyInIntentComment = apiUploadPositions.every(h =>
  h.before.includes('no') &&
  h.before.includes('longer funnel through') &&
  h.before.includes('FormData round-trip') &&
  h.before.includes('/api/upload') &&
  !h.after.includes('fetch') &&
  !h.after.includes('await')
);

console.log('api/upload only appears in intent comment, not as a call:', onlyInIntentComment);
