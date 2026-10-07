"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "@/components/Shell";
import { api, Empty, Icon, Score, useApi } from "@/components/ui";

export default function ContentList() {
  const { id, project, refreshJobs } = useProject();
  const router = useRouter();
  const { data, mutate } = useApi<any[]>(`/api/p/${id}/content`, { refreshInterval: (d?: any[]) => (d?.some((c) => !["done", "error"].includes(c.status)) ? 3000 : 0) });
  const [url, setUrl] = useState("");
  const [kw, setKw] = useState("");
  return (
    <div className="space-y-4 p-4 md:p-6">
      <form
        className="card flex flex-wrap gap-2 p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const a = await api(`/api/p/${id}/content`, "POST", { url, keyword: kw });
          refreshJobs();
          router.push(`/p/${id}/content/${a.id}`);
        }}
      >
        <input className="input min-w-[280px] flex-[2]" placeholder={`https://${project?.domain ?? ""}/…`} value={url} onChange={(e) => setUrl(e.target.value)} required />
        <input className="input min-w-[200px] flex-1" placeholder="keyword objetivo" value={kw} onChange={(e) => setKw(e.target.value)} required />
        <button className="btn-p"><Icon name="play" />Analizar</button>
      </form>
      {!data?.length ? (
        <Empty>—</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((c) => (
            <Link key={c.id} href={`/p/${id}/content/${c.id}`} className="card group flex items-center gap-4 p-4 transition hover:border-acc">
              <Score value={c.score} size={56} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.keyword}</div>
                <div className="truncate text-xs text-ink-400">{c.url.replace(/^https?:\/\//, "")}</div>
                <div className="mt-1 text-xs text-ink-400">{c.status !== "done" ? c.status : new Date(c.createdAt).toLocaleDateString("es-CL")}</div>
              </div>
              <button
                className="btn-g opacity-0 group-hover:opacity-100"
                onClick={async (e) => { e.preventDefault(); await api(`/api/p/${id}/content`, "DELETE", { cid: c.id }); mutate(); }}
              >
                <Icon name="trash" />
              </button>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
