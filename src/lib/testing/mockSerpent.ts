import http from "node:http";

/** Servidor Serpent falso para tests: registra cada request y responde con fixtures por endpoint. */
export async function startMockSerpent(opts: { organicFor?: (q: string, path: string) => { url: string; title?: string }[] } = {}) {
  const hits: { path: string; q: string; params: Record<string, string> }[] = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url!, "http://x");
    const params = Object.fromEntries(u.searchParams);
    const q = params.q ?? "";
    hits.push({ path: u.pathname, q, params });
    if (req.headers["x-api-key"] !== "test-key") {
      res.writeHead(401).end("{}");
      return;
    }
    const organic = (opts.organicFor?.(q, u.pathname) ?? [{ url: `https://site${q.length}.cl/${encodeURIComponent(q)}` }]).map((o, i) => ({ position: i + 1, title: o.title ?? o.url, url: o.url, snippet: "" }));
    const deep = u.pathname === "/api/search";
    const body = {
      success: true,
      query: q,
      results: {
        organic,
        peopleAlsoAsk: deep ? [{ question: `¿qué es ${q}?` }, { question: `¿cómo elegir ${q}?` }] : [],
        relatedSearches: deep ? [{ query: `${q} barato` }, { query: `${q} chile` }] : [],
        aiOverview: null,
        ads: [],
        shopping: deep ? [{ title: "x", link: "https://shop.cl" }] : [],
      },
      ...(deep ? { metadata: { hasPeopleAlsoAsk: true, hasRelatedSearches: true, hasShopping: true } } : { meta: { totalOrganic: organic.length } }),
    };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, hits, close: () => new Promise((r) => srv.close(r)) };
}
