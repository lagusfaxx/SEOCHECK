"use client";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { useProject } from "@/components/Shell";
import { NextActions } from "@/components/NextActions";
import { api } from "@/components/ui";
export default function Tasks() {
  const { id } = useProject();
  const { mutate } = useSWRConfig();
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="p-4 md:p-6">
      <form
        className="card mb-4 flex flex-wrap gap-2 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(`/api/p/${id}/tasks`, "POST", {
              title,
              reason: reason || "Tarea manual",
            });
            setTitle("");
            setReason("");
            await mutate(`/api/p/${id}/tasks`);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <input
          className="input flex-1"
          placeholder="Nueva tarea"
          maxLength={200}
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="input flex-1"
          placeholder="Por qué importa / instrucciones"
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button className="btn-p">Crear tarea</button>
        {error && <p className="w-full text-rose-700">{error}</p>}
      </form>
      <NextActions all />
    </div>
  );
}
