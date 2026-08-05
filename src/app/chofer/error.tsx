'use client';

import { useEffect } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// CUANDO NO SE PUDO LEER, SE DICE QUE NO SE PUDO LEER.
//
// Las consultas de `chofer.ts` LANZAN ante un error de base en vez de devolver
// vacío, y esta pantalla es la otra mitad de esa decisión: sin ella, el usuario
// vería la pantalla en blanco de Next y sin el texto de abajo leería "no llevo
// nada comprobado" — teniendo veinte tickets mandados. Un chofer que cree que
// sus fotos no llegaron vuelve a mandarlas todas, o le habla a su oficina.
//
// El `digest` se pinta y se registra por el mismo motivo que en /dashboard: es
// lo único que después permite encontrar la petición que falló.
// ═══════════════════════════════════════════════════════════════════════════
export default function ChoferError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void import('@/lib/logger').then(({ logger }) =>
      logger.error('chofer.boundary', { digest: error.digest ?? 'sin-digest', err: error.message }),
    );
  }, [error]);

  return (
    <div className="card p-6">
      <p className="text-xl font-semibold tracking-tight">No se pudieron cargar tus datos</p>
      <p className="mt-2 text-base leading-relaxed" style={{ color: 'var(--muted)' }}>
        Falló la conexión, no tus comprobantes. Esto NO significa que no hayas
        comprobado nada: significa que ahorita no se pudo leer.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-5 w-full rounded-2xl text-lg font-semibold"
        style={{ minHeight: 56, background: 'var(--marca)', color: 'var(--marca-fg)' }}
      >
        Volver a intentar
      </button>
      {error.digest && (
        <p className="mt-4 text-sm select-all" style={{ color: 'var(--faint)' }}>
          Código: <span className="tabular">{error.digest}</span>
        </p>
      )}
    </div>
  );
}
