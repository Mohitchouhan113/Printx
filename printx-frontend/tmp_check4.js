const fs = require('fs');
const S = fs.readFileSync('app/s/[slug]/page.jsx','utf8');
const b = S.indexOf('{', S.indexOf('const submitOrder = async (chosenPayment) => {') + 1) + 1;
const submitOrderEnd = S.indexOf('};', b);
const body = S.slice(b, submitOrderEnd+2);

const has = (s) => body.indexOf(s) !== -1;

const step1 = {
  noFetchWithRetryToApiUpload: !has('fetchWithRetry(') && !has("fetch('/api/upload'") && !has('fetch("/api/upload"'),
  noApiUploadFetchFormDataContext: true
};

const step2 = {
  uploadLoopHead: has('for (const item of activeFiles)'),
  extractFileObj: has('fileObj = item.file || item.rawFile || item'),
  instanceofGuard: has('instanceof File || fileObj instanceof Blob'),
  cleanNameAssign: has('const cleanName = fileObj.name ? fileObj.name.replace('),
  sanitizeRegex: has('/[^a-zA-Z0-9.-]/g'),
  fallbackName: has("'file.pdf'"),
  filePathTemplate: has('`orders/${Date.now()}_${cleanName}`'),
  storageFromPrintFiles: has('.storage') && has('.from(') && has("'print-files'"),
  uploadWithUpsert: has('.upload(filePath, fileObj, { upsert: true })'),
  storageErrorLog: has("console.error('Supabase Storage Error:', uploadErr)"),
  throwUploadFail: has("throw new Error('Failed to upload ") && body.indexOf('+ cleanName') !== -1,
  getPublicUrlCall: has('getPublicUrl(filePath)'),
  publicUrlField: has('file_url: publicUrlData.publicUrl'),
  fileNameField: has('file_name: cleanName'),
  fileSizeField: has('file_size: fileObj.size || 0'),
  emptyMetadataGuard: has('if (uploadedFilesMetadata.length === 0)'),
  emptyMetadataThrow: has("throw new Error('Please select at least one file to upload')")
};

const result = Object.assign({}, step1, step2);
let missing = [];
for (const [k,v] of Object.entries(result)){
  if(!v) missing.push(k);
}
console.log('missing count', missing.length);
if(missing.length) console.log('MISSING', missing);
else console.log('ALL STEP1+STEP2 CHECKS PASS');

console.log('summary', result);
