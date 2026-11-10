'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { recargarSiChunkViejo } from '@/lib/recarga-chunk';

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Chunk viejo tras un despliegue: se recarga UNA vez por ventana (F16); si no aplica, sigue el registro normal.
    recargarSiChunkViejo(error);
    void import('@/lib/logger').then(({ logger }) => logger.error('admin.boundary', {
      digest: error.digest ?? 'sin-digest', err: error.message,
    }));
  }, [error]);

  return (
    <main className="min-h-dvh flex items-center justify-center p-8" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
      <div className="max-w-xl w-full card p-6">
        <p className="etiqueta-mono text-xs" style={{ color: 'var(--muted)' }}>ADMIN · INCIDENTE AISLADO</p>
        <h1 className="font-display text-2xl font-semibold mt-2">No se pudo cargar esta área.</h1>
        <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>
          El resto de la consola puede seguir disponible. Reintenta; si continúa, comparte el código con soporte.
        </p>
        <div className="flex flex-wrap gap-3 mt-6">
          <button type="button" onClick={reset} className="px-4 py-2 rounded-full text-sm font-medium" style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>Reintentar</button>
          <Link href="/admin" className="px-4 py-2 rounded-full text-sm font-medium hairline">Ir al resumen</Link>
        </div>
        {error.digest && <p className="mt-5 text-xs select-all" style={{ color: 'var(--faint)' }}>Código: {error.digest}</p>}
      </div>
    </main>
  );
}
