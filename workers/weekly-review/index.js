const RECIPIENT = 'carhartconsulting@outlook.com';
const FROM = 'Pittsburgh Divorce Leads <leads@pittsburghdivorces.com>';

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

async function syncLeadsToSheet(env, leads) {
  const token = await getSheetsToken(env);
  const sheetId = env.GOOGLE_SHEET_ID;

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Leads!A:Z:clear`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });

  const headers = [
    'ID', 'Submitted', 'First Name', 'Last Name', 'Email', 'Phone',
    'County', 'Divorce Stage', 'Children Involved', 'Asset Complexity', 'Description',
  ];
  const rows = [
    headers,
    ...leads.map(l => [
      l.id,
      l.created_at?.slice(0, 16).replace('T', ' ') ?? '',
      l.first_name, l.last_name, l.email,
      l.phone ?? '', l.county ?? '', l.divorce_stage ?? '',
      l.children_involved ?? '', l.asset_complexity ?? '', l.description ?? '',
    ]),
  ];

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Leads!A1?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(`Sheets write error: ${JSON.stringify(data.error)}`);
}

export default {
  async scheduled(event, env) {
    const now = new Date();
    const weekEnding = now.toISOString().slice(0, 10);
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Aggregate counts by status for the past 7 days
    const counts = await env.DB.prepare(`
      SELECT status, COUNT(*) as count
      FROM leads
      WHERE created_at >= datetime('now', '-7 days')
      GROUP BY status
    `).all();

    const tally = { new: 0, spam: 0, duplicate: 0 };
    for (const row of counts.results ?? []) {
      tally[row.status] = row.count;
    }
    const total = tally.new + tally.spam + tally.duplicate;

    // Fetch qualified leads for detail table
    const qualified = await env.DB.prepare(`
      SELECT first_name, last_name, email, phone, county, divorce_stage,
             children_involved, asset_complexity, description, created_at
      FROM leads
      WHERE status = 'new'
        AND created_at >= datetime('now', '-7 days')
      ORDER BY created_at DESC
    `).all();

    // Save snapshot for ROI trend tracking
    await env.DB.prepare(`
      INSERT INTO weekly_snapshots
        (week_ending, total_leads, qualified_leads, spam_leads, duplicate_leads, ad_spend, cost_per_lead)
      VALUES (?, ?, ?, ?, ?, NULL, NULL)
    `).bind(weekEnding, total, tally.new, tally.spam, tally.duplicate).run();

    // Sync all qualified leads to Google Sheet (if credentials are configured)
    if (env.GOOGLE_SHEET_ID && env.GOOGLE_SHEETS_REFRESH_TOKEN) {
      try {
        const allLeads = await env.DB.prepare(`
          SELECT id, created_at, first_name, last_name, email, phone,
                 county, divorce_stage, children_involved, asset_complexity, description
          FROM leads
          WHERE status = 'new'
          ORDER BY created_at DESC
        `).all();
        await syncLeadsToSheet(env, allLeads.results ?? []);
      } catch (err) {
        console.error('Sheets sync failed:', err);
      }
    }

    const html = buildEmail(weekStart, weekEnding, tally, total, qualified.results ?? []);

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [RECIPIENT],
        subject: `Weekly Lead Report — ${weekStart} to ${weekEnding}`,
        html,
      }),
    });
  },
};

function buildEmail(weekStart, weekEnding, tally, total, leads) {
  const summaryRows = [
    ['Total Submitted', total],
    ['Qualified (emailed to you)', tally.new],
    ['Filtered as Spam', tally.spam],
    ['Filtered as Duplicate', tally.duplicate],
  ].map(([label, val]) => `
    <tr>
      <td style="padding:8px 12px;background:#f5f5f5;font-weight:600;border-bottom:1px solid #e0e0e0">${label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0">${val}</td>
    </tr>`).join('');

  const leadRows = leads.length === 0
    ? '<tr><td colspan="6" style="padding:16px;text-align:center;color:#999">No qualified leads this week.</td></tr>'
    : leads.map(l => `
      <tr style="border-bottom:1px solid #eee">
        <td style="padding:8px 10px">${l.first_name} ${l.last_name}</td>
        <td style="padding:8px 10px">${l.email}</td>
        <td style="padding:8px 10px">${l.phone || '—'}</td>
        <td style="padding:8px 10px">${l.county || '—'}</td>
        <td style="padding:8px 10px">${l.divorce_stage || '—'}</td>
        <td style="padding:8px 10px;color:#777;font-size:12px">${l.created_at.slice(0, 16).replace('T', ' ')}</td>
      </tr>`).join('');

  const leadsSection = `
    <h3 style="margin:32px 0 12px;font-size:15px">Qualified Leads (${tally.new})</h3>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#1a1a1a;color:#fff">
            <th style="padding:8px 10px;text-align:left">Name</th>
            <th style="padding:8px 10px;text-align:left">Email</th>
            <th style="padding:8px 10px;text-align:left">Phone</th>
            <th style="padding:8px 10px;text-align:left">County</th>
            <th style="padding:8px 10px;text-align:left">Stage</th>
            <th style="padding:8px 10px;text-align:left">Submitted</th>
          </tr>
        </thead>
        <tbody>${leadRows}</tbody>
      </table>
    </div>`;

  return `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;color:#222;max-width:700px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 4px;color:#1a1a1a">Weekly Lead Report</h2>
  <p style="margin:0 0 24px;color:#777;font-size:13px">${weekStart} through ${weekEnding} — pittsburghdivorces.com</p>

  <h3 style="margin:0 0 12px;font-size:15px">Summary</h3>
  <table style="width:100%;border-collapse:collapse;font-size:14px;max-width:400px">
    ${summaryRows}
  </table>

  ${leadsSection}

  <p style="margin:40px 0 0;font-size:12px;color:#aaa">
    Sent automatically every Monday at 9am ET. Reply to this email or log in to
    Cloudflare D1 to view full lead history.
  </p>
</body>
</html>`;
}
