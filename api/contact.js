export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { name, email, type, state, message } = req.body || {};
  if (!name || !type || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Log submission to Vercel function logs (always works, no setup needed)
  console.log('[CONTACT SUBMISSION]', JSON.stringify({ name, email, type, state, message, ts: new Date().toISOString() }));

  // If RESEND_API_KEY is set in Vercel env vars, send an email
  if (process.env.RESEND_API_KEY && process.env.CONTACT_EMAIL) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Midwest Airsoft Hub <onboarding@resend.dev>',
          to: process.env.CONTACT_EMAIL,
          subject: `[MidwestAirsoft] ${type.toUpperCase()} submission — ${state || 'Unknown state'}`,
          text: `Name: ${name}\nEmail: ${email || 'not provided'}\nType: ${type}\nState: ${state || 'not specified'}\n\n${message}`
        })
      });
    } catch (err) {
      console.error('Email send failed:', err);
      // Still return success — submission was logged
    }
  }

  return res.status(200).json({ ok: true });
}
