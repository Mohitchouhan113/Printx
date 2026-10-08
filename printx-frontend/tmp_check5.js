const fs = require('fs');
const S = fs.readFileSync('app/s/[slug]/page.jsx','utf8');
const submitOrderStart = S.indexOf('const submitOrder = async (chosenPayment) => {');
const b = S.indexOf('{', submitOrderStart) + 1;
const submitOrderEnd = S.indexOf('};', submitOrderStart);
const submitBody = S.slice(b, submitOrderEnd+2);

const storageFromHits = [];
let k = b;
while(k < submitOrderEnd){
  const idx = S.indexOf('.storage.from', k);
  if(idx < 0 || idx > submitOrderEnd) break;
  const ctx = S.slice(idx-40, idx+120);
  storageFromHits.push({ idx, ctx });
  k = idx + 15;
}

const apiUploadHits = [];
k = b;
while(k < submitOrderEnd){
  const idx = S.indexOf('/api/upload', k);
  if(idx < 0 || idx > submitOrderEnd) break;
  const ctx = S.slice(idx-120, idx+120);
  apiUploadHits.push({ idx, ctx });
  k = idx + 11;
}

console.log('storage.from hits in submitOrder body:', storageFromHits.length);
console.log('api/upload hits in submitOrder body:', apiUploadHits.length);
console.log('storage.from contexts:', storageFromHits.map(h=>h.ctx));
console.log('api/upload contexts:', apiUploadHits.map(h=>h.ctx));
