# Implementación del backlog 21–75

El alcance es el flujo completo de producto. Los cambios están en el checkout y requieren las nuevas migraciones antes de desplegar. Los cobros no están activados: el usuario eligió Stripe y definirá los precios después.

## Funcionalidad disponible

| Puntos | Implementación |
| --- | --- |
| 21, 24 | Explicación de GSC y opción persistente para continuar sin conectar, con las limitaciones visibles. |
| 22 | Guía paso a paso desde cero en `/p/:id/guide`: propiedad, TXT, verificación, sitemap y conexión. **Faltan capturas reales de la interfaz de Google**; el ejemplo del registro se identifica como ilustrativo. |
| 23 | Instrucciones para NIC Chile, Cloudflare, GoDaddy, Hostinger, Squarespace (migración de Google Domains), Route 53 y otros. Se distingue registrador de proveedor DNS; no se recomienda cambiar nameservers. |
| 25–27 | Checklist permanente en el resumen, experiencia persistente (Principiante/SEO/Agencia), explicaciones contextuales y glosario. Elegir Agencia como experiencia no cambia el plan comercial. |
| 28–31 | Hasta cinco acciones principales agrupadas por código de incidencia, con motivo, evidencia GSC o enlaces internos y categoría. Incluye incidencias críticas, oportunidades de alertas y mejoras. |
| 32–33 | Tareas manuales y automáticas, estados detectado/pendiente/solucionado/reapareció/ignorado, historial de transiciones y controles para gestionar el grupo. Los ignorados persisten. Un crawl parcial o una URL no observada no confirma una solución. |
| 34–38 | Markdown técnico conservado, PDF ejecutivo, selector de nivel, comparación contra el crawl anterior y branding de agencia (nombre, contacto, color y logo PNG/JPEG). La salud es una métrica interna, no una puntuación de Google. |
| 39 | Versiones programadas semanales/mensuales, procesadas por el worker. Guardan los datos disponibles en ese momento; no ejecutan otra auditoría ni envían correo. Historial descargable. |
| 40 | CSV separado de incidencias con URL/código/severidad/detalle. Incluye escape de fórmulas para hojas de cálculo. |
| 41–44 | Evidencia medida separada de propuestas editoriales; tipos artículo/categoría/landing/producto; contenido, meta y encabezados propios incluidos en el brief; rechazo de precios y afirmaciones de garantía/descuento/certificación sin respaldo. |
| 45–49 | Regeneración de una sección con preservación del resto, versiones y restauración, H2/H3 obligatorios/eliminados, exportación de implementación para Claude Code y comparación en vivo de title/meta/encabezados. |
| 50–55 | Nombres completos de fuentes, relevancia visible, bloqueos existentes conservados, solapamiento medido de SERPs por keyword, páginas candidatas/asignación manual y recomendaciones crear/optimizar/revisar consolidación. La canibalización es una señal a revisar, no una orden de borrar páginas. |
| 56–61 | Filtros por texto/tipo/propiedad, exploraciones nombradas guardadas en PostgreSQL con filtros, navegación existente keyword/SERP/dominio/URL/keywords, tareas desde nodos, brief de cluster y comparación medida con competidor. |
| 62–67 | Oportunidades GSC en Rankings y botón para monitorearlas sin cobro inmediato, ganadores/perdedores, gráfico existente de historial, alertas configurables y cambios de URL rankeada. |
| 68–71, 73–75 | Costos por JobRun/tipo, límites finitos por workspace, prueba de 14 días, Agencia y white-label exclusivo. Las nuevas creaciones se serializan para impedir que dos peticiones usen el último cupo. Un registro duradero evita recuperar cupo mensual borrando briefs/informes. |
| 72 | Stripe Checkout mensual y compra de un informe, portal de suscripción y webhooks firmados e idempotentes. **Pendiente de precios, claves, webhook y prueba de Stripe en modo test**. No se inventaron importes ni se realizaron cobros. |

## Límites iniciales

Los límites iniciales están en `src/lib/plans.ts`, separados del precio. Son editables en el código antes de lanzamiento y no son planes ilimitados.

| Plan | Proyectos | URLs por crawl | Keywords | Rankings activos | Briefs | Informes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Prueba, 14 días | 1 | 200 | 200 | 20 | 3 | 2 |
| SEO | 3 | 2.000 | 2.000 | 200 | 30 | 10 |
| Agencia | 20 | 10.000 | 10.000 | 2.000 | 200 | 100 |

Proyectos, keywords y rankings se comparten entre proyectos del workspace. URLs se limitan por crawl. Briefs e informes son mensuales en UTC en planes pagos y acumulados durante la prueba. Los informes sueltos agregan un crédito utilizable para guardar una versión de los últimos datos incluso si se agotó el cupo; no compran una auditoría ni llamadas a APIs. El costo de infraestructura no aparece como costo de proveedor.

Los workspaces existentes reciben 14 días de gracia desde la migración, sin modificar `createdAt`. Las cuotas cuentan trabajos históricos conservados mediante backfill. La prueba vencida conserva acceso de lectura y exportación; no permite nuevos trabajos de proveedores.

## Stripe: activación pendiente

1. Crear precios positivos en Stripe: SEO y Agencia recurrentes mensuales; informe con pago único. No habilitar promociones o impuestos automáticos sin adaptar la comprobación del total del pedido.
2. Configurar de forma segura `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SEO`, `STRIPE_PRICE_AGENCY`, `STRIPE_PRICE_REPORT` y `APP_URL` HTTPS. No usar `NEXT_PUBLIC_*` para claves. El webhook secret debe estar disponible como valor real para verificar firmas localmente.
3. Registrar `POST /api/billing/webhook` en Stripe. Eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`. Este único endpoint usa la firma de Stripe en vez de Basic Auth/cookies.
4. Habilitar y configurar el portal de clientes en Stripe. Los cambios de plan allí deben usar los mismos price IDs del servidor.
5. Probar en modo test pago, renovación, cambio/cancelación y reenvío del mismo evento antes de activar live. Confirmar que la moneda, total y pedido coinciden. La implementación usa el SDK oficial y recupera el estado actual para no conceder permisos basados en un webhook antiguo.
6. En entornos con red restringida, permitir `api.stripe.com`. El navegador del cliente también debe poder llegar a Checkout/Portal de Stripe.

Los reembolsos y disputas no cambian créditos automáticamente en esta versión. Requieren conciliación del administrador; no activar venta live sin acordar esa operación. Las suscripciones se validan hasta el fin del período pagado, y los eventos de cancelación/impago revocan permisos.

## Validación y límites prácticos

- Las pruebas de integración utilizan exclusivamente una base de desarrollo/pruebas.
- No se ha probado una cuenta real de Google, un DNS de producción, proveedores de SEO de pago ni un cobro real.
- El validador de afirmaciones es conservador y basado en patrones. Rechaza precios y afirmaciones sensibles detectadas, pero no demuestra la veracidad de toda frase generada; la UI pide revisión editorial.
- La comparación de implementación comprueba correspondencia textual de title/meta/H2/H3. No certifica calidad semántica, conversiones ni impacto en Google.
- Los informes programados necesitan reiniciar el worker en cada instancia; el estado de pg-boss y los informes se conserva en PostgreSQL.
- Las capturas de Google deben obtenerse de una cuenta de demostración con permiso, sin tokens ni datos de clientes. El entorno actual bloquea el acceso a `search.google.com`; no se sustituyeron por capturas ficticias.
