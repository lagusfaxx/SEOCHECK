/**
 * Envío de correos transaccionales (recuperación de contraseña, invitaciones).
 * Con RESEND_API_KEY + MAIL_FROM se envía por Resend (API HTTP, sin dependencias).
 * Sin configuración, el link queda en el log del servidor para que el administrador lo entregue a mano.
 */
export async function sendMail(to: string, subject: string, text: string, link?: string): Promise<"sent" | "logged"> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (key && from) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as Response);
    if (res.ok) return "sent";
    console.error("[mail] no se pudo enviar", res.status, (await res.text()).slice(0, 200));
  }
  // sin proveedor: solo el destinatario y el link en el log del servidor (nunca en la respuesta HTTP)
  console.warn(`[mail] sin proveedor de correo configurado. Para ${to} — ${subject}${link ? `: ${link}` : ""}`);
  return "logged";
}
