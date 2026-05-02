#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const env = fs
  .readFileSync(path.join(root, '.env.local'), 'utf8')
  .split('\n')
  .reduce((acc, line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) acc[m[1]] = m[2].replace(/^["']|["']$/g, '');
    return acc;
  }, {});

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/apply-migration.mjs <migration-file.sql>');
  process.exit(1);
}

const sql = fs.readFileSync(path.resolve(file), 'utf8');
console.log(`Applying ${file} (${sql.length} bytes) to project ${env.SUPABASE_PROJECT_ID}`);

const r = await fetch(
  `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_ID}/database/query`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  },
);
const text = await r.text();
console.log('HTTP', r.status);
console.log(text);
process.exit(r.status >= 400 ? 1 : 0);
