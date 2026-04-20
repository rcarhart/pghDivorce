export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const {
    first_name, last_name, email, phone,
    county, divorce_stage, children_involved,
    asset_complexity, description, consent,
    turnstile_token,
  } = body;

  if (!first_name || !last_name || !email || !consent) {
    return Response.json({ error: 'Please fill out all required fields.' }, { status: 400 });
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
    return Response.json({ error: 'Bot verification failed. Please try again.' }, { status: 403 });
  }

  try {
    await env.DB.prepare(`
      INSERT INTO leads
        (first_name, last_name, email, phone, county, divorce_stage,
         children_involved, asset_complexity, description, consent, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      first_name, last_name, email,
      phone ?? null, county ?? null, divorce_stage ?? null,
      children_involved ?? null, asset_complexity ?? null,
      description ?? null, consent ? 1 : 0, ip,
    ).run();

    return Response.json({ success: true });
  } catch (err) {
    console.error('DB insert failed:', err);
    return Response.json({ error: 'Failed to save your request. Please try again.' }, { status: 500 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
