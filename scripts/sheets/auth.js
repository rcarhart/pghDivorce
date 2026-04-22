#!/usr/bin/env node
/**
 * One-time OAuth flow for Google Sheets access.
 * Run once: node scripts/sheets/auth.js
 */
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../');
const envPath = join(ROOT, '.env');

function getEnvVar(key) {
  if (process.env[key]) return process.env[key];
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const [k, ...rest] = line.split('=');
      if (k?.trim() === key) return rest.join('=').trim();
    }
  }
  return null;
}

const clientId = getEnvVar('GOOGLE_SHEETS_CLIENT_ID');
const clientSecret = getEnvVar('GOOGLE_SHEETS_CLIENT_SECRET');

if (!clientId || !clientSecret) {
  console.error('Add GOOGLE_SHEETS_CLIENT_ID and GOOGLE_SHEETS_CLIENT_SECRET to your .env file first.');
  process.exit(1);
}

const REDIRECT = 'http://localhost:8080/oauth2callback';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', REDIRECT);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

console.log('\nOpen this URL in your browser:\n');
console.log(authUrl.toString());
console.log('\nWaiting for redirect on http://localhost:8080 ...\n');

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8080');
  const code = url.searchParams.get('code');
  if (!code) { res.end('No code.'); return; }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
    }),
  });

  const tokens = await tokenRes.json();
  res.end('Done! You can close this tab.');
  server.close();

  if (tokens.refresh_token) {
    console.log('\nSuccess! Add this to your .env file:\n');
    console.log(`GOOGLE_SHEETS_REFRESH_TOKEN=${tokens.refresh_token}`);
  } else {
    console.error('\nNo refresh_token in response:', tokens);
  }
});

server.listen(8080);
