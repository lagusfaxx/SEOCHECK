/**
 * Envío de correos transaccionales (recuperación de contraseña, invitaciones).
 * Con RESEND_API_KEY + MAIL_FROM se envía por Resend (API HTTP, sin dependencias).
 * Sin configuración, el link queda en el log del servidor para que el administrador lo entregue a mano.
 */
export async function sendMail(to: string, subject: string, text: string, link?: string, html?: string): Promise<"sent" | "logged"> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (key && from) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text, ...(html ? { html } : {}) }),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as Response);
    if (res.ok) return "sent";
    console.error("[mail] no se pudo enviar", res.status, (await res.text()).slice(0, 200));
  }
  // sin proveedor: solo el destinatario y el link en el log del servidor (nunca en la respuesta HTTP)
  console.warn(`[mail] sin proveedor de correo configurado. Para ${to} — ${subject}${link ? `: ${link}` : ""}`);
  return "logged";
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Correo simple con la marca: un título, párrafos y un botón. Devuelve texto y HTML. */
export function mailTemplate(title: string, paragraphs: string[], cta?: { label: string; url: string }, footer = "Si no fuiste tú, puedes ignorar este correo.") {
  const text = [title, "", ...paragraphs, ...(cta ? ["", `${cta.label}: ${cta.url}`] : []), "", footer, "", "FSV Search · FSV"].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f7;font-family:Inter,Arial,sans-serif;color:#14141f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td style="font-size:13px;font-weight:600;letter-spacing:.08em;color:#5151db">FSV SEARCH</td></tr>
<tr><td style="padding-top:16px;font-size:22px;font-weight:600;line-height:1.3">${esc(title)}</td></tr>
${paragraphs.map((p) => `<tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#3d3d4e">${esc(p)}</td></tr>`).join("")}
${cta ? `<tr><td style="padding-top:24px"><a href="${esc(cta.url)}" style="display:inline-block;background:#5151db;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">${esc(cta.label)}</a></td></tr>
<tr><td style="padding-top:16px;font-size:12px;color:#8a8a99;word-break:break-all">Si el botón no funciona, copia este link: ${esc(cta.url)}</td></tr>` : ""}
<tr><td style="padding-top:24px;font-size:12px;color:#8a8a99">${esc(footer)}</td></tr>
</table>
<p style="font-size:12px;color:#8a8a99">FSV Search · FSV · Santiago, Chile</p>
</td></tr></table></body></html>`;
  return { text, html };
}
