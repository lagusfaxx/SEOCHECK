/** Contexto de las rutas de los módulos expertos (mismo que product-api). */
export type ProCtx = { id: string; url: URL; body: any; user: { id: string; email: string }; admin: boolean };
export type ProHandler = (c: ProCtx) => Promise<unknown>;
export type ProRoutes = { GET?: Record<string, ProHandler>; POST?: Record<string, ProHandler>; PATCH?: Record<string, ProHandler>; DELETE?: Record<string, ProHandler> };

/** Error con status HTTP para el cliente (400 por defecto). */
export class ProError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Módulo experto: rutas bajo /api/p/:id/pro/<prefix>/…, tarea diaria y gancho al terminar un crawl. */
export type ProModule = {
  prefix: string;
  routes: ProRoutes;
  /** se llama una vez al día por proyecto (worker pro.daily) */
  daily?: (projectId: string) => Promise<unknown>;
  /** se llama al terminar un crawl (completed o partial) */
  afterCrawl?: (crawlId: string, projectId: string) => Promise<unknown>;
};
