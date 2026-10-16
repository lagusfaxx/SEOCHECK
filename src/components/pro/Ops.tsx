"use client";
import { useProject } from "../Shell";
import { api, useAction, useApi } from "../ui";
import ExpertPanel from "./ExpertPanel";
export default function Ops() {
  const { id } = useProject();
  const base = `/api/p/${id}/pro/ops`;
  const { data, mutate } = useApi<any>(id ? `${base}/webhooks` : null);
  const { data: access, mutate: accessMutate } = useApi<any[]>(
    id ? `${base}/access` : null,
  );
  const { data: tokens, mutate: tokensMutate } = useApi<any[]>(
    id ? `${base}/tokens` : null,
  );
  const [remove, busy] = useAction(async (path: string, body: object) => {
    await api(`${base}/${path}`, "DELETE", body);
    await Promise.all([mutate(), tokensMutate(), accessMutate()]);
  });
  return (
    <div className="space-y-4">
      <ExpertPanel
        kind="ops"
        links={[{ title: "Todas las tareas y responsables", path: "tasks" }]}
        forms={[
          {
            title: "Guardar plantilla de tarea",
            path: "template",
            fields: [
              { name: "name", label: "Nombre de plantilla", required: true },
              { name: "title", label: "Título de tarea", required: true },
              {
                name: "reason",
                label: "Qué hacer y cómo verificarlo",
                type: "textarea",
                required: true,
              },
            ],
          },
          {
            title: "Configurar avisos",
            path: "webhook",
            hint: "Slack usa una URL entrante. WhatsApp usa una plantilla aprobada con un parámetro de texto y las credenciales del servidor. Los avisos se reintentan hasta cinco veces.",
            fields: [
              {
                name: "format",
                label: "Canal",
                type: "select",
                options: ["slack", "whatsapp", "json"],
              },
              {
                name: "url",
                label: "URL entrante (Slack o webhook)",
                type: "url",
              },
              {
                name: "recipient",
                label: "Número de WhatsApp con código de país",
              },
              { name: "template", label: "Nombre de plantilla de WhatsApp" },
              {
                name: "events",
                label: "Eventos (uno por línea)",
                type: "textarea",
                parse: "lines",
                required: true,
                placeholder: "daily.digest\ncrawl.completed\nalert.created",
              },
            ],
          },
          {
            title: "Restringir acceso al proyecto",
            path: "access",
            method: "PATCH",
            hint: "Al crear la lista de acceso, los miembros solo ven este proyecto si están incluidos. Dueños y administradores conservan acceso.",
            fields: [
              {
                name: "email",
                label: "Correo del miembro del espacio",
                required: true,
              },
              {
                name: "role",
                label: "Permiso",
                type: "select",
                options: ["viewer", "editor"],
              },
            ],
          },
          {
            title: "Crear token de lectura de API",
            path: "token",
            hint: "El token se muestra una vez. Permite leer los análisis en /api/expert/{proyecto}/{módulo} con Authorization: Bearer TOKEN.",
            fields: [
              { name: "name", label: "Nombre de integración", required: true },
            ],
          },
        ]}
      />
      {data && (
        <section className="rounded border p-4">
          <h3 className="font-medium">Canales configurados</h3>
          {!data.hooks.length && <p>No hay canales configurados.</p>}
          {data.hooks.map((h: any) => (
            <div className="my-2 flex gap-4" key={h.id}>
              <span>
                {h.format} · {h.events.join(", ")} ·{" "}
                {h.lastError ?? h.lastStatus ?? "Sin envíos"}
              </span>
              <button
                disabled={busy}
                onClick={() => remove("webhook", { id: h.id })}
              >
                Eliminar
              </button>
            </div>
          ))}
          <h3 className="mt-4 font-medium">Entregas recientes</h3>
          {data.deliveries.map((d: any) => (
            <p className="text-sm" key={d.id}>
              {d.event} · {d.status} · Intentos: {d.attempts}{" "}
              {d.lastError ?? ""}
            </p>
          ))}
        </section>
      )}
      {access && (
        <section className="rounded border p-4">
          <h3>Acceso restringido</h3>
          {access.map((a) => (
            <p key={a.userId}>
              {a.email ?? a.userId} · {a.role === "viewer" ? "solo lectura" : "edición"}{" "}
              <button
                disabled={busy}
                onClick={() => remove("access", { userId: a.userId })}
              >
                Quitar
              </button>
            </p>
          ))}
        </section>
      )}
      {tokens && (
        <section className="rounded border p-4">
          <h3>Tokens de lectura</h3>
          {tokens.map((t) => (
            <p key={t.id}>
              {t.name} · {t.revokedAt ? "Revocado" : "Activo"}{" "}
              {!t.revokedAt && (
                <button
                  disabled={busy}
                  onClick={() => remove("token", { id: t.id })}
                >
                  Revocar
                </button>
              )}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
