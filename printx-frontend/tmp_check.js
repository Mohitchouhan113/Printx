const S = require('fs').readFileSync('app/s/[slug]/page.jsx','utf8');
const b = S.indexOf('{', S.indexOf('const submitOrder = async (chosenPayment) => {') + 1) + 1;
const body = S.slice(b, b+45000);
const requiredChecks = [
  'for (const item of activeFiles)',
  'fileObj = item.file || item.rawFile || item',
  '!(fileObj instanceof File || fileObj instanceof Blob) continue',
  "cleanName = fileObj.name ? fileObj.name.replace(/[^a-zA-Z0-9.-]/g, '_' ) : 'file.pdf'",
  'filePath = `orders/${Date.now()}_${cleanName}`',
  ".storage.from('print-files').upload(filePath, fileObj, { upsert: true })",
  "console.error('Supabase Storage Error:', uploadErr)",
  "throw new Error('Failed to upload ' + cleanName)",
  ".storage.from('print-files').getPublicUrl(filePath)",
  'file_url: publicUrlData.publicUrl',
  'file_name: cleanName',
  'file_size: fileObj.size || 0',
  'if (uploadedFilesMetadata.length === 0)',
  "throw new Error('Please select at least one file to upload')",
  ".from('print_jobs')",
  '.insert({',
  'filesMetadata: uploadedFilesMetadata',
  'file_url: uploadedFilesMetadata[0]?.file_url || null',
  'const data = res.data ? { success: true'
];
let missing=[];
for(const req of requiredChecks){
  if(!body.includes(req)){ missing.push(req); }
}
console.log('missing count', missing.length);
if(missing.length){
  console.log('MISSING', missing);
} else {
  console.log('ALL REQUIRED SNIPPETS PRESENT');
}
console.log('apiUploadCallPresent:', body.includes('/api/upload') || body.includes('fetchWithRetry('));
