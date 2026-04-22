#!/usr/bin/env node
/**
 * One-time OAuth flow to get a refresh token for the Google Ads API.
 * Run once: node scripts/ads/auth.js
 * Paste the code from the browser redirect back into the terminal.
 */
import { createServer } from 'http';
import { readEnv } from './util.js';

const env = readEnv();
const SCOPES = 'https://www.googleapis.com/auth/adwords';
const REDIRECT = 'http://localhost:8080/oauth2callback';

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', env.GOOGLE_ADS_CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

console.log('\nOpen this URL in your browser:\n');
console.log(authUrl.toString());
console.log('\nWaiting for redirect on http://localhost:8080 ...\n');

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8080');
  const code = url.searchParams.get('code');
  if (!code) {
    res.end('No code found.');
    return;
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
    }),
  });

  const tokens = await tokenRes.json();

  res.end('Done! You can close this tab.');
  server.close();

  if (tokens.refresh_token) {
    console.log('\nSuccess! Add this to your .env file:\n');
    console.log(`GOOGLE_ADS_REFRESH_TOKEN=${tokens.refresh_token}`);
  } else {
    console.error('\nNo refresh_token in response:', tokens);
  }
});

server.listen(8080);
