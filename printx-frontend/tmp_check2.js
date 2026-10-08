const fs = require('fs');
const S = fs.readFileSync('app/s/[slug]/page.jsx','utf8');
const b = S.indexOf('{', S.indexOf('const submitOrder = async (chosenPayment) => {') + 1) + 1;
const body = S.slice(b, b+45000);

const regexChecks = [
  /for \(const item of activeFiles\)/,
  /fileObj = item\.file \|> item\.rawFile \|> item/,
  /instanceof File \|\| fileObj instanceof Blob/,
  /cleanName = fileObj\.name \? fileObj\.name\.replace\(/,
  /filePath = `orders\/\${Date\.now()}_\${cleanName}`/,
  /\.storage\.from\(['"]print-files['"]\)/,
  /console\.error\(['"]Supabase Storage Error:['"]/,
  /throw new Error\(['"]Failed to upload [^"']+['"]\)/,
  /getPublicUrl\(filePath\)/,
  /file_url: publicUrlData\.publicUrl/,
  /file_name: cleanName/,
  /file_size: fileObj\.size \|\| 0/,
  /if \(uploadedFilesMetadata\.length === 0\)/,
  /throw new Error\(['"]Please select at least one file to upload['"]\)/,
  /\.from\(['"]print_jobs['"]\)/,
  /\.insert\(\{/,
  /filesMetadata: uploadedFilesMetadata/,
  /file_url: uploadedFilesMetadata\[0\]?\.file_url \|\| null/,
  /const data = res\.data \? \{ success: true/
];

let missing=[];
regexChecks.forEach((re, idx) => {
  if(!re.test(body)){ missing.push(idx+': '+re); }
});
console.log('regex missing count', missing.length);
if(missing.length){
  console.log('MISSING', missing);
} else {
  console.log('ALL REGEX CHECKS PASS');
}
console.log('any api/upload literal in submitOrder body:', /\/api\/upload/.test(body));
console.log('any fetchWithRetry( in submitOrder body:', /fetchWithRetry\(/.test(body));
