"use client";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <main className="grid min-h-screen place-items-center bg-white p-6 dark:bg-ink-950">
      <div className="max-w-md text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/fsv-search.png" alt="FSV Search" className="mx-auto h-6 w-auto dark:invert" />
        <h1 className="mt-10 text-2xl font-semibold tracking-tight">Algo salió mal</h1>
        <p className="mt-2 text-sm text-ink-500">
          Ya quedó registrado. Intenta de nuevo; si sigue pasando, escríbenos a <a className="text-acc underline" href="mailto:contacto@fsvc.cl">contacto@fsvc.cl</a>
          {error.digest && <> indicando el código <code className="font-mono">{error.digest}</code></>}.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={reset} className="btn-p">Reintentar</button>
          <a href="/app" className="btn">Ir a mis proyectos</a>
        </div>
      </div>
    </main>
  );
}
