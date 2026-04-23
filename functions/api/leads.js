const ALLOWED_ORIGIN = 'https://pittsburghdivorces.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function corsJson(data, init = {}) {
  return Response.json(data, { ...init, headers: { ...CORS_HEADERS, ...(init.headers ?? {}) } });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELD_LIMITS = {
  first_name: 50,
  last_name: 50,
  email: 100,
  phone: 20,
  county: 60,
  divorce_stage: 60,
  children_involved: 20,
  asset_complexity: 20,
  description: 2000,
};

const SPAM_NAMES = /^(test|testing|asdf|foo|bar|baz|aaa|bbb|xxx|yyy|zzz|123|admin|name|user|none|na|n\/a)$/i;

function isSpamName(name) {
  if (!name || name.length < 2) return true;
  if (SPAM_NAMES.test(name.trim())) return true;
  // single repeated character: "aaaa", "1111"
  if (/^(.)\1+$/.test(name.trim())) return true;
  return false;
}

const SHEET_HEADERS = [
  'ID', 'Submitted', 'First Name', 'Last Name', 'Email', 'Phone',
  'County', 'Divorce Stage', 'Children Involved', 'Asset Complexity', 'Description',
];

function leadToRow(lead) {
  return [
    lead.id,
    lead.created_at?.slice(0, 16).replace('T', ' ') ?? '',
    lead.first_name, lead.last_name, lead.email,
    lead.phone ?? '', lead.county ?? '', lead.divorce_stage ?? '',
    lead.children_involved ?? '', lead.asset_complexity ?? '', lead.description ?? '',
  ];
}

async function appendLeadToSheet(env, lead) {
  if (!env.GOOGLE_SHEET_ID || !env.GOOGLE_SHEETS_REFRESH_TOKEN) return;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_SHEETS_CLIENT_ID,
      client_secret: env.GOOGLE_SHEETS_CLIENT_SECRET,
      refresh_token: env.GOOGLE_SHEETS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const { access_token } = await tokenRes.json();
  if (!access_token) throw new Error('Sheets token refresh failed');

  const sheetId = env.GOOGLE_SHEET_ID;
  const authHeader = { 'Authorization': `Bearer ${access_token}` };

  // Write header row if the sheet is empty
  const checkRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Leads!A1`,
    { headers: authHeader }
  );
  const checkData = await checkRes.json();
  if (!checkData.values?.length) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Leads!A1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [SHEET_HEADERS] }),
      }
    );
  }

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Leads!A:K:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [leadToRow(lead)] }),
    }
  );
}

async function sendLeadEmail(env, lead) {
  const rows = [
    ['Name', `${lead.first_name} ${lead.last_name}`],
    ['Email', lead.email],
    ['Phone', lead.phone || '—'],
    ['County', lead.county || '—'],
    ['Divorce Stage', lead.divorce_stage || '—'],
    ['Children Involved', lead.children_involved || '—'],
    ['Asset Complexity', lead.asset_complexity || '—'],
    ['Submitted', lead.created_at],
    ['IP Address', lead.ip_address || '—'],
  ];

  const tableRows = rows
    .map(([label, value]) => `
      <tr>
        <td style="padding:8px 12px;background:#f5f5f5;font-weight:600;width:160px;border-bottom:1px solid #e0e0e0">${label}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0">${value}</td>
      </tr>`)
    .join('');

  const description = lead.description
    ? `<h3 style="margin:24px 0 8px;font-size:14px;color:#555">Situation Description</h3>
       <p style="margin:0;padding:12px;background:#f9f9f9;border-left:3px solid #c8a96e;font-style:italic">${lead.description}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;color:#222;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 4px;color:#1a1a1a">New Lead — Pittsburgh Divorce</h2>
  <p style="margin:0 0 20px;color:#777;font-size:13px">Submitted via pittsburghdivorces.com</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    ${tableRows}
  </table>
  ${description}
  <p style="margin:32px 0 0;font-size:12px;color:#aaa">
    This lead was automatically sent from pittsburghdivorces.com.
    Log in to Cloudflare D1 to view all leads.
  </p>
</body>
</html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Pittsburgh Divorce Leads <leads@pittsburghdivorces.com>',
      to: ['carhartconsulting@outlook.com'],
      subject: `New Lead: ${lead.first_name} ${lead.last_name}${lead.county ? ` — ${lead.county}` : ''}`,
      html,
    }),
  });
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return corsJson({ error: 'Invalid request body.' }, { status: 400 });
  }

  const {
    first_name, last_name, email, phone,
    county, divorce_stage, children_involved,
    asset_complexity, description, consent,
    turnstile_token,
  } = body;

  if (!first_name || !last_name || !email || !consent) {
    return corsJson({ error: 'Please fill out all required fields.' }, { status: 400 });
  }

  for (const [field, max] of Object.entries(FIELD_LIMITS)) {
    const val = body[field];
    if (val && typeof val === 'string' && val.length > max) {
      return corsJson({ error: `${field} exceeds maximum allowed length.` }, { status: 400 });
    }
  }

  if (!EMAIL_RE.test(email)) {
    return corsJson({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  // Verify Turnstile token server-side
  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET_KEY,
      response: turnstile_token,
      remoteip: ip,
    }),
  });

  const { success } = await verifyRes.json();
  if (!success) {
    return corsJson({ error: 'Bot verification failed. Please try again.' }, { status: 403 });
  }

  const created_at = new Date().toISOString();

  try {
    let status = 'new';

    if (isSpamName(first_name) || isSpamName(last_name)) {
      status = 'spam';
    } else {
      const dupCheck = await env.DB
        .prepare(`SELECT id FROM leads WHERE email = ? AND created_at > datetime('now', '-1 day') LIMIT 1`)
        .bind(email.toLowerCase())
        .first();
      if (dupCheck) status = 'duplicate';
    }

    const insertResult = await env.DB.prepare(`
      INSERT INTO leads
        (first_name, last_name, email, phone, county, divorce_stage,
         children_involved, asset_complexity, description, consent, ip_address, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      first_name, last_name, email.toLowerCase(),
      phone ?? null, county ?? null, divorce_stage ?? null,
      children_involved ?? null, asset_complexity ?? null,
      description ?? null, consent ? 1 : 0, ip, status,
    ).run();

    if (status === 'new') {
      const lead = {
        id: insertResult?.meta?.last_row_id ?? null,
        first_name, last_name, email, phone, county, divorce_stage,
        children_involved, asset_complexity, description, ip_address: ip, created_at,
      };
      waitUntil(
        Promise.all([
          sendLeadEmail(env, lead).catch(err => console.error('Email failed:', err)),
          appendLeadToSheet(env, lead).catch(err => console.error('Sheets failed:', err)),
        ])
      );
    }

    return corsJson({ success: true });
  } catch (err) {
    console.error('DB error:', err);
    return corsJson({ error: 'Failed to save your request. Please try again.' }, { status: 500 });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}
