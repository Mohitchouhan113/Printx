const fs = require('fs');
const S = fs.readFileSync('app/s/[slug]/page.jsx','utf8');
const b = S.indexOf('{', S.indexOf('const submitOrder = async (chosenPayment) => {') + 1) + 1;
const submitOrderEnd = S.indexOf('};', b);
const body = S.slice(b, submitOrderEnd+2);

const has = (s) => body.indexOf(s) !== -1;

const checks = {
  loopHead: has('for (const item of activeFiles)'),
  storageFromPrintFiles: has('.storage') && body.indexOf('.from(') !== -1 && body.includes("'print-files'"),
  uploadCall: has('.upload(filePath, fileObj, { upsert: true })'),
  storageErrorLog: has("console.error('Supabase Storage Error:', uploadErr)"),
  throwUploadFail: has("throw new Error('Failed to upload ") && body.indexOf('+ cleanName') !== -1,
  getPublicUrlCall: has('getPublicUrl(filePath)'),
  publicUrlField: has('file_url: publicUrlData.publicUrl'),
  fileNameField: has('file_name: cleanName'),
  fileSizeField: has('file_size: fileObj.size || 0'),
  emptyMetadataGuard: has('if (uploadedFilesMetadata.length === 0)'),
  emptyMetadataThrow: has("throw new Error('Please select at least one file to upload')"),
  insertTable: has(".from('print_jobs')"),
  insertCall: has('.insert({'),
  filesMetadataField: has('filesMetadata: uploadedFilesMetadata'),
  fileUrlField: has('file_url: uploadedFilesMetadata[0]?.file_url || null'),
  dataSuccessShape: has('const data = res.data ? { success: true'),
  apiUploadRemoved: !body.includes('/api/upload') && !body.includes('fetchWithRetry(')
};

let missing = [];
for (const [k,v] of Object.entries(checks)){
  if(!v) missing.push(k);
}
console.log('missing count', missing.length);
if(missing.length) console.log('MISSING', missing);
else console.log('ALL DIRECT CHECKS PASS');
console.log('api/upload literal in body:', body.includes('/api/upload'));
console.log('fetchWithRetry( in body:', body.includes('fetchWithRetry('));
