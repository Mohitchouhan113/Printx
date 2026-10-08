const fs = require('fs');
const S = fs.readFileSync('app/s/[slug]/page.jsx','utf8');
const submitOrderStart = S.indexOf('const submitOrder = async (chosenPayment) => {');
const afterDataStart = S.indexOf('const data = res.data ? { success: true', submitOrderStart);
const body = S.slice(submitOrderStart, afterDataStart+400);

function has(s){ return body.indexOf(s) !== -1; }

const checks = {
  fromPrintJobs: has(".from('print_jobs')"),
  insertObj: has('.insert({'),
  filesMetadataField: has('filesMetadata: uploadedFilesMetadata'),
  fileUrlField: has('file_url: uploadedFilesMetadata[0]?.file_url || null'),
  orderPayloadPresent: has('const orderPayload = {'),
  selectStar: has(".select('*')"),
  singleCall: has('.single()'),
  apiUploadCall: body.includes('fetchWithRetry(') || body.includes("fetch('/api/upload'") || body.includes('fetch("/api/upload"'),
  intentNote: has('// No /api/upload call here')
};

let missing=[];
for(const [k,v] of Object.entries(checks)){
  if(!v) missing.push(k);
}
console.log('missing count', missing.length);
if(missing.length) console.log('MISSING', missing);
else console.log('ALL POST-UPLOAD SNIPPETS PRESENT');
console.log('checks', checks);
