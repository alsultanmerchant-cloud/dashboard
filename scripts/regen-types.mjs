import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a},{});
const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_ID}/types/typescript?included_schemas=public`, { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } });
if (r.status >= 400) {
  console.error('HTTP', r.status, await r.text());
  process.exit(1);
}
const j = await r.json();
const types = j.types || j;
const target = path.join(root, 'src/lib/supabase/types.ts');
fs.writeFileSync(target, typeof types === 'string' ? types : JSON.stringify(types));
console.log(`Wrote ${target} (${(typeof types === 'string' ? types.length : JSON.stringify(types).length)} bytes)`);
