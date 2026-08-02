import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="glass sticky top-0 z-10 border-b" style={{ borderColor: 'var(--line)' }}>
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="font-semibold tracking-tight text-lg">Likida</span>
          <nav className="flex items-center gap-6 text-sm" style={{ color: 'var(--muted)' }}>
            <Link href="/demo" className="hover:opacity-70">Demo</Link>
            <Link href="/login" className="hover:opacity-70">Entrar</Link>
          </nav>
        </div>
      </header>

      <section className="flex-1 flex items-center">
        <div className="max-w-3xl mx-auto px-6 py-24 text-center animate-in">
          <div className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full mb-6"
               style={{ color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }}>
            Liquidación de viajes, automática
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.1]">
            El cierre diario de tu flota,<br />resuelto por WhatsApp.
          </h1>
          <p className="mt-6 text-lg" style={{ color: 'var(--muted)' }}>
            El operador manda sus comprobantes por WhatsApp. Likida los lee, los cuadra contra el
            anticipo y la política, detecta diferencias al instante y entrega la liquidación en PDF.
          </p>
          <div className="mt-10 flex items-center justify-center gap-3">
            <Link href="/demo"
              className="px-5 py-2.5 rounded-xl text-sm font-medium"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
              Ver el demo
            </Link>
            <Link href="/login"
              className="px-5 py-2.5 rounded-xl text-sm font-medium hairline"
              style={{ color: 'var(--ink)' }}>
              Entrar al panel
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t py-6 text-center text-sm" style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}>
        Likida · liquidación de operaciones logísticas en México
      </footer>
    </main>
  );
}
