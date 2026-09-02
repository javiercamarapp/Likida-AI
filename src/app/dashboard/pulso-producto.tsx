'use client';

// ═══════════════════════════════════════════════════════════════════════════
// EL PULSO DEL PANEL — producto_evento (0251), el hermano de PulsoSitio (0223).
//
// Un POST de fuego-y-olvido en cada cambio de ruta: el pathname, nada más.
// Es el servidor quien decide el tenant (de la sesión) y la pantalla (del
// catálogo cerrado) — este componente no sabe ni manda nada de eso. CERO
// datos del usuario: sin id, sin IP guardada, sin UA, sin cookies propias —
// minimización LFPDPPP en el producto de una empresa que trata datos
// fiscales. Si el POST falla, no pasa nada: la analítica jamás puede
// costarle nada al operador (sin await, sin reintento).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export function PulsoProducto() {
  const ruta = usePathname();
  useEffect(() => {
    if (!ruta) return;
    void fetch('/api/dashboard/evento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruta }),
      keepalive: true,
    }).catch(() => { /* la analítica nunca estorba */ });
  }, [ruta]);
  return null;
}
