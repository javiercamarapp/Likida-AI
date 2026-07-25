'use client';

import Link from 'next/link';

// Error boundary del segmento dashboard: un fallo de red/render NO deja pantalla
// rota; muestra un mensaje sobrio y una salida. (Read-only, sin acciones.)
export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-10 text-center max-w-md">
        <p className="text-xl font-semibold tracking-tight">No se pudo cargar el panel</p>
        <p className="mt-2 text-base" style={{ color: 'var(--muted)' }}>
          Hubo un problema al leer los datos. Puedes reintentar.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button onClick={reset} className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Reintentar</button>
          <Link href="/" className="px-4 py-2 rounded-lg text-sm font-medium hairline">Inicio</Link>
        </div>
      </div>
    </div>
  );
}
