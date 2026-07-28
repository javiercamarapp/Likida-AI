// Sin esto, cada navegación al panel es pantalla EN BLANCO hasta que Supabase
// responde: la página es force-dynamic y no hay nada que mostrar mientras tanto.
// En una demo en vivo, una pantalla vacía se lee como producto lento.
export default function Loading() {
  return (
    <div className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="h-8 w-56 rounded animate-pulse" style={{ background: 'var(--line)' }} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-24 animate-pulse" style={{ background: 'var(--line)' }} />
          ))}
        </div>
        <div className="card h-64 animate-pulse" style={{ background: 'var(--line)' }} />
      </div>
    </div>
  );
}
