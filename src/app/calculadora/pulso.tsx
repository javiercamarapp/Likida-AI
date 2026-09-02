'use client';

// ═══════════════════════════════════════════════════════════════════════════
// EL PULSO DEL SITIO — la analítica mínima y honesta (0223).
//
// Un POST de fuego-y-olvido al montar: página + 'pageview'. CERO datos
// personales: ni IP guardada, ni user-agent, ni cookies, ni fingerprinting —
// minimización LFPDPPP en el sitio de una empresa que trata datos fiscales.
// Si el POST falla, no pasa nada: la analítica jamás puede costarle nada al
// visitante (por eso tampoco hay await ni reintento).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect } from 'react';

export function PulsoSitio({ pagina }: { pagina: string }) {
  useEffect(() => {
    void fetch('/api/marketing/evento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pagina, evento: 'pageview' }),
      keepalive: true,
    }).catch(() => { /* la analítica nunca estorba */ });
  }, [pagina]);
  return null;
}
