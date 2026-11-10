'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
// Imports directos y no el barril de ui-v2: el barril arrastra `BotonReintentar` (next/navigation) al paquete del chat.
import { StatusChip } from '../../ui-v2/componentes/status-chip';
import { Boton } from '../../ui-v2/componentes/boton';
import { Icono } from '../../ui-v2/componentes/icono';
import { MessageCircleQuestion } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// «DECIDE HOY» en la portada del Copiloto (F5, mejora 3). Lee /api/admin/copiloto/briefing (lectores reales, cada fuente por
// separado) y pinta una tarjeta por decisión: qué pasa, qué se propone y dónde se toma. No ejecuta nada: «Preguntar» solo le hace la
// pregunta al Copiloto. Una fuente caída se dice; jamás «sin pendientes» sobre una lectura que falló. También ofrece preguntar
// sobre la pantalla que Javier tiene abierta (el contexto de pantalla viaja en cada pregunta).
// ═══════════════════════════════════════════════════════════════════════════

interface Tarjeta {
  id: string;
  severidad: 'alta' | 'media' | 'info';
  titulo: string;
  detalle: string;
  decision: string;
  href: string | null;
  pregunta: string;
}
interface Briefing { tarjetas: Tarjeta[]; fuentesCiegas: string[] }

const TONO = { alta: 'bad', media: 'warn', info: 'ok' } as const;
const ROTULO = { alta: 'Urgente', media: 'Pendiente', info: 'Al día' } as const;

export default function BriefingDecideHoy({ onPreguntar, deshabilitado, endpoint = '/api/admin/copiloto' }: {
  onPreguntar: (q: string) => void;
  deshabilitado: boolean;
  endpoint?: string;
}) {
  const [b, setB] = useState<Briefing | 'error' | null>(null);
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    let vivo = true;
    fetch(`${endpoint}/briefing`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (vivo) setB(Array.isArray(d?.tarjetas) ? { tarjetas: d.tarjetas, fuentesCiegas: Array.isArray(d.fuentesCiegas) ? d.fuentesCiegas : [] } : 'error'); })
      .catch(() => { if (vivo) setB('error'); });
    return () => { vivo = false; };
  }, [endpoint, intento]);
  const cargar = () => { setB(null); setIntento((i) => i + 1); };

  return (
    <section className="rv-chat__briefing" aria-label="Decide hoy" aria-busy={b === null || undefined}>
      <h2 className="rv-chat__briefing-titulo">Decide hoy</h2>
      {b === null && <p className="rv-chat__nota">Leyendo lo que espera tu decisión…</p>}
      {b === 'error' && (
        <p className="rv-chat__nota" role="alert">
          No disponible ahora. No es cero: el briefing no se pudo leer.{' '}
          <button type="button" className="rv-btn rv-btn--ghost rv-btn--sm" onClick={cargar}>Reintentar</button>
        </p>
      )}
      {b !== null && b !== 'error' && (
        <>
          <ul className="rv-chat__briefing-lista">
            {b.tarjetas.map((t) => (
              <li key={t.id} className="rv-tarjeta rv-chat__briefing-tarjeta" data-severidad={t.severidad}>
                <div className="rv-chat__briefing-cab">
                  <StatusChip tono={TONO[t.severidad]}>{ROTULO[t.severidad]}</StatusChip>
                  <strong>{t.titulo}</strong>
                </div>
                <p className="rv-chat__nota">{t.detalle}</p>
                {t.severidad !== 'info' && <p className="rv-chat__nota"><b>Propuesta:</b> {t.decision}</p>}
                <div className="rv-chat__briefing-acciones">
                  {t.href && <Link href={t.href} className="rv-btn rv-btn--secondary rv-btn--sm">Abrir pantalla</Link>}
                  <Boton tamano="sm" variante="ghost" disabled={deshabilitado} onClick={() => onPreguntar(t.pregunta)} icono={<Icono icono={MessageCircleQuestion} />}>Preguntar</Boton>
                </div>
              </li>
            ))}
          </ul>
          {b.fuentesCiegas.length > 0 && (
            <p className="rv-chat__nota" role="status">No se pudo leer: {b.fuentesCiegas.join(', ')}. De esas fuentes el briefing no afirma nada.</p>
          )}
        </>
      )}
      <div className="rv-chat__briefing-acciones">
        <Boton tamano="sm" variante="secondary" disabled={deshabilitado} onClick={() => onPreguntar('¿Qué debo mirar en la pantalla que tengo abierta?')}>Preguntar sobre esta pantalla</Boton>
      </div>
    </section>
  );
}
