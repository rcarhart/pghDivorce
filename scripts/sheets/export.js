#!/usr/bin/env node
/**
 * Export qualified leads from D1 to a Google Sheet.
 * Overwrites the sheet with fresh data each run — always in sync with the DB.
 *
 * Usage: node scripts/sheets/export.js
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../');

// ── env loading ──────────────────────────────────────────────────────────────

function readEnv() {
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...rest] = trimmed.split('=');
      if (key && rest.length && !process.env[key.trim()]) {
        process.env[key.trim()] = rest.join('=').trim();
      }
    }
  }
  const required = [
    'CF_API_KEY', 'CF_EMAIL',
    'GOOGLE_SHEETS_CLIENT_ID', 'GOOGLE_SHEETS_CLIENT_SECRET', 'GOOGLE_SHEETS_REFRESH_TOKEN',
    'GOOGLE_SHEET_ID',
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`\nMissing .env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  return Object.fromEntries(required.map(k => [k, process.env[k]]));
}

// ── Cloudflare D1 ────────────────────────────────────────────────────────────

async function queryD1(env, sql) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/0e84061cdb103bc2895fc03547a1e5fa/d1/database/6c1636aa-34a8-4bea-97d3-5daa70bb0ae7/query`,
    {
      method: 'POST',
      headers: {
        'X-Auth-Key': env.CF_API_KEY,
        'X-Auth-Email': env.CF_EMAIL,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql }),
    }
  );
  const data = await res.json();
  if (!data.success) throw new Error(`D1 error: ${JSON.stringify(data.errors)}`);
  return data.result[0].results;
}

// ── Google Sheets auth ───────────────────────────────────────────────────────

async function getSheetsToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_SHEETS_CLIENT_ID,
      client_secret: env.GOOGLE_SHEETS_CLIENT_SECRET,
      refresh_token: env.GOOGLE_SHEETS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Sheets token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

const SHEET_HEADERS = [
  'ID', 'Submitted', 'First Name', 'Last Name', 'Email', 'Phone',
  'County', 'Divorce Stage', 'Children Involved', 'Asset Complexity', 'Description',
];

function leadToRow(l) {
  return [
    l.id,
    l.created_at?.slice(0, 16).replace('T', ' ') ?? '',
    l.first_name, l.last_name, l.email,
    l.phone ?? '', l.county ?? '', l.divorce_stage ?? '',
    l.children_involved ?? '', l.asset_complexity ?? '', l.description ?? '',
  ];
}

// ── Google Sheets write ──────────────────────────────────────────────────────

async function appendNewLeads(sheetsToken, sheetId, leads) {
  const authHeader = { 'Authorization': `Bearer ${sheetsToken}` };

  // Read existing ID column to find what's already in the sheet
  const readRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Leads!A:A`,
    { headers: authHeader }
  );
  const readData = await readRes.json();
  const existingValues = readData.values ?? [];

  // Write headers if sheet is empty
  if (existingValues.length === 0) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Leads!A1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [SHEET_HEADERS] }),
      }
    );
  }

  // Skip row 1 (headers), collect IDs already in the sheet
  const existingIds = new Set(existingValues.slice(1).map(r => String(r[0])).filter(Boolean));
  const newLeads = leads.filter(l => !existingIds.has(String(l.id)));

  if (newLeads.length === 0) return 0;

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Leads!A:K:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: newLeads.map(leadToRow) }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(`Sheets append error: ${JSON.stringify(data.error)}`);
  return newLeads.length;
}

// ── main ─────────────────────────────────────────────────────────────────────

const env = readEnv();

console.log('Fetching qualified leads from D1...');
const leads = await queryD1(env, `
  SELECT
    id, created_at, first_name, last_name, email, phone,
    county, divorce_stage, children_involved, asset_complexity, description
  FROM leads
  WHERE status = 'new'
  ORDER BY created_at DESC
`);

console.log(`Found ${leads.length} qualified leads.`);

console.log('Authenticating with Google Sheets...');
const sheetsToken = await getSheetsToken(env);

console.log('Appending any new leads to sheet (existing rows untouched)...');
const added = await appendNewLeads(sheetsToken, env.GOOGLE_SHEET_ID, leads);

console.log(`\n✓ ${added} new lead(s) added to Google Sheet (${leads.length - added} already present).`);
console.log(`  https://docs.google.com/spreadsheets/d/${env.GOOGLE_SHEET_ID}`);
