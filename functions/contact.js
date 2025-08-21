// Cloudflare Pages Function — handles POST /contact
// Sends an email via MailChannels (no external account needed)
//
// 1) In your Cloudflare Pages project, go to Settings ▸ Environment variables
//    Add: TO_EMAIL = info@thomas-octave.be
//         FROM_EMAIL = no-reply@thomas-octave.be   (or info@thomas-octave.be)
// 2) Place this file at /functions/contact.js in your repo (or upload in Pages UI)
// 3) Point your form action to "/contact" (method="POST") and send form fields: name, email, subject, message, website(honeypot)

export async function onRequestPost({ request, env }) {
  try {
    const form = await request.formData();
    const name = (form.get("name") || "").toString().trim().slice(0, 100);
    const email = (form.get("email") || "").toString().trim().slice(0, 200);
    const subject = (form.get("subject") || "Demande de devis").toString().trim().slice(0, 150);
    const message = (form.get("message") || "").toString().trim().slice(0, 8000);
    const honeypot = (form.get("website") || "").toString(); // hidden field — if filled => bot

    // Simple validation
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (honeypot) return json({ ok: true }); // silently accept spam
    if (!name || !isEmail || !message) {
      return json({ ok: false, error: "invalid_input" }, 400);
    }

    const ip = request.headers.get("cf-connecting-ip") || "";
    const ua = request.headers.get("user-agent") || "";

    const to = env.TO_EMAIL || "info@thomas-octave.be";
    const from = env.FROM_EMAIL || "info@thomas-octave.be";

    const text = `Nouvelle demande de devis\n\n`+
      `Nom: ${name}\n`+
      `Email: ${email}\n`+
      `Sujet: ${subject}\n`+
      `IP: ${ip}\n`+
      `UA: ${ua}\n\n`+
      `${message}`;

    const html = `<!doctype html><meta charset="utf-8">`+
      `<h2>Nouvelle demande de devis</h2>`+
      `<table style="border-collapse:collapse;font:14px system-ui,Segoe UI,Roboto"><tbody>`+
      row("Nom", escapeHtml(name))+
      row("Email", escapeHtml(email))+
      row("Sujet", escapeHtml(subject))+
      row("IP", escapeHtml(ip))+
      row("UA", escapeHtml(ua))+
      `</tbody></table>`+
      `<pre style="white-space:pre-wrap;font:14px ui-monospace,Consolas,Menlo">${escapeHtml(message)}</pre>`;

    const payload = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: "Formulaire site web" },
      reply_to: { email, name },
      subject: `Demande de devis — ${subject}`,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html", value: html }
      ],
    };

    const resp = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return json({ ok: false, error: "mail_error", detail }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: "server_error" }, 500);
  }
}

function row(k, v){
  return `<tr><th style="text-align:left;padding:6px 8px;border:1px solid #ddd;background:#f7f7f7">${k}</th>`+
         `<td style="padding:6px 8px;border:1px solid #ddd">${v}</td></tr>`
}

function escapeHtml(s){
  return s.replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

function json(obj, status=200){
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
