// /functions/contact.js — Cloudflare Pages Function using Resend API
// 1) Get an API key at https://resend.com, then set it in Cloudflare Pages:
//    Settings → Environment variables → add RESEND_API_KEY (secret)
//    (Optionally) add RESEND_FROM (e.g. "Thomas Octave <info@thomas-octave.be>")
//    (Optionally) add CONTACT_TO (defaults to info@thomas-octave.be)
// 2) While your domain isn't verified in Resend, keep RESEND_FROM unset — we will use onboarding@resend.dev.
// 3) Your form should POST to /contact with fields: name, email, subject, message and a hidden honeypot "website".

export async function onRequestPost({ request, env }) {
  try {
    const form = await request.formData();
    const name = (form.get("name") || "").toString().trim().slice(0, 100);
    const email = (form.get("email") || "").toString().trim().slice(0, 200);
    const subject = (form.get("subject") || "Demande de devis").toString().trim().slice(0, 150);
    const message = (form.get("message") || "").toString().trim().slice(0, 8000);
    const honeypot = (form.get("website") || "").toString(); // if filled → bot

    if (honeypot) return json({ ok: true }); // silently accept bots
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!name || !isEmail || !message) return json({ ok:false, error:"invalid_input" }, 400);

    const ip = request.headers.get("cf-connecting-ip") || "";
    const ua = request.headers.get("user-agent") || "";

    const RESEND_API_KEY = env.RESEND_API_KEY;
    if (!RESEND_API_KEY) return json({ ok:false, error:"missing_api_key" }, 500);

    const from = env.RESEND_FROM || "Thomas Octave <onboarding@resend.dev>"; // use your domain after verification
    const to = env.CONTACT_TO || "info@thomas-octave.be";

    const text = `Nouvelle demande de devis\n\n`+
      `Nom: ${name}\nEmail: ${email}\nSujet: ${subject}\n`+
      `IP: ${ip}\nUA: ${ua}\n\n${message}`;

    const html = `<!doctype html><meta charset="utf-8">`+
      `<h2>Nouvelle demande de devis</h2>`+
      `<table style="border-collapse:collapse;font:14px system-ui,Segoe UI,Roboto"><tbody>`+
      row("Nom", esc(name))+row("Email", esc(email))+row("Sujet", esc(subject))+row("IP", esc(ip))+row("UA", esc(ua))+`</tbody></table>`+
      `<pre style="white-space:pre-wrap;font:14px ui-monospace,Consolas,Menlo">${esc(message)}</pre>`;

    const payload = { from, to, reply_to: email, subject: `Demande de devis — ${subject}`, text, html };

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const bodyText = await resp.text().catch(() => "");
    if (!resp.ok) return json({ ok:false, error:"resend_error", status: resp.status, detail: bodyText }, 502);
    return json({ ok:true, status: resp.status });
  } catch (err) {
    return json({ ok:false, error:"server_error" }, 500);
  }
}

function row(k, v){
  return `<tr><th style="text-align:left;padding:6px 8px;border:1px solid #ddd;background:#f7f7f7">${k}</th>`+
         `<td style="padding:6px 8px;border:1px solid #ddd">${v}</td></tr>`
}
function esc(s){
  return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
function json(obj, status=200){
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
