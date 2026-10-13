import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-white p-6 dark:bg-ink-950">
      <div className="max-w-md text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/fsv-search.png" alt="FSV Search" className="mx-auto h-6 w-auto dark:invert" />
        <p className="mt-10 font-mono text-sm text-ink-400">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Esta página no existe</h1>
        <p className="mt-2 text-sm text-ink-500">Puede que el link esté mal escrito o que ya no tengas acceso a ese proyecto.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link href="/app" className="btn-p">Ir a mis proyectos</Link>
          <Link href="/" className="btn">Inicio</Link>
        </div>
      </div>
    </main>
  );
}
