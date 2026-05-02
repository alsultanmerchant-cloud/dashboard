#!/usr/bin/env node
// Run an arbitrary SQL query via the Supabase Management API.
// Usage: node scripts/probe-query.mjs "select 1"
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

const sql = process.argv[2];
if (!sql) {
  console.error('Usage: node scripts/probe-query.mjs "<sql>"');
  process.exit(1);
}

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
