// /functions/contact.js — Cloudflare Pages Function using Resend API + Cloudflare Turnstile
// 1) Get an API key at https://resend.com, then set it in Cloudflare Pages:
//    Settings → Variables and Secrets → add RESEND_API_KEY (secret)
//    (Optionally) add RESEND_FROM (e.g. "Thomas Octave <info@thomas-octave.be>")
//    (Optionally) add CONTACT_TO (defaults to info@thomas-octave.be)
// 2) While your domain isn't verified in Resend, keep RESEND_FROM unset — we will use onboarding@resend.dev.
// 3) Your form should POST to /contact with fields: name, email, subject, message and a hidden honeypot "website".
// 4) Anti-spam (Cloudflare Turnstile):
//    add TURNSTILE_SECRET (secret) = la "Secret Key" du widget Turnstile.
//    ⚠️ Ne jamais mettre cette clé dans le dépôt GitHub.
// 5) (Optionnel) Liste noire : add BLOCKLIST (texte), éléments séparés par des virgules,
//    ex. "spammeur@gmail.com, @domaine-pourri.com, site-arnaque.com, crypto"
//    Tout message contenant l'un de ces éléments (nom, e-mail, sujet ou message) est ignoré en silence.

export async function onRequestPost({ request, env }) {
  try {
    const form = await request.formData();
    const name = (form.get("name") || "").toString().trim().slice(0, 100);
    const email = (form.get("email") || "").toString().trim().slice(0, 200);
    const subject = (form.get("subject") || "Demande de devis").toString().trim().slice(0, 150);
    const message = (form.get("message") || "").toString().trim().slice(0, 8000);
    const honeypot = (form.get("website") || "").toString(); // if filled → bot
    const turnstileToken = (form.get("cf-turnstile-response") || "").toString();

    if (honeypot) return json({ ok: true }); // silently accept bots
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!name || !isEmail || !message) return json({ ok:false, error:"invalid_input" }, 400);

    const ip = request.headers.get("cf-connecting-ip") || "";
    const ua = request.headers.get("user-agent") || "";

    // --- Anti-spam 1 : Cloudflare Turnstile ---
    if (!env.TURNSTILE_SECRET) return json({ ok:false, error:"missing_turnstile_secret" }, 500);
    const human = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, ip);
    if (!human) return json({ ok:false, error:"captcha_failed" }, 403);

    // --- Anti-spam 2 : liste noire (faux succès, pour ne pas alerter le spammeur) ---
    if (isBlocked([name, email, subject, message], env.BLOCKLIST)) return json({ ok: true });

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

// Vérifie le jeton Turnstile auprès de Cloudflare (un jeton n'est valable qu'une fois, 5 min)
async function verifyTurnstile(token, secret, ip){
  if (!token) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const out = await resp.json();
    return out.success === true;
  } catch {
    return false;
  }
}

// true si l'un des champs contient un élément de la liste noire (insensible à la casse)
function isBlocked(fields, blocklist){
  if (!blocklist) return false;
  const terms = blocklist.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
  if (!terms.length) return false;
  const haystack = fields.join("\n").toLowerCase();
  return terms.some(t => haystack.includes(t));
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
