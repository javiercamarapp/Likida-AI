'use client';

import { useState, useRef, useEffect } from 'react';
import { mxn } from '@/lib/formato';
import { MarcoPublico } from '../ui-v2/componentes/marco-publico';
import { Boton } from '../ui-v2/componentes/boton';

interface Comprobante { concepto: string; monto: number; folio?: string; cfdiUuid?: string; rfcReceptor?: string; label: string }
interface Bubble { from: 'op' | 'likida'; text: string }

// 🔴 INVENTADO: escenario de demo Silao→Laredo. Anticipo = total comprobado,
// así la ÚNICA diferencia es el diésel $200 sobre política (luce el diferenciador).
const ANTICIPO = 10600;
const PRESETS: Comprobante[] = [
  { concepto: 'diesel', monto: 4200, folio: 'DS-8801', label: 'Diésel $4,200 (sobre tope)' },
  { concepto: 'diesel', monto: 3800, folio: 'DS-8802', label: 'Diésel $3,800' },
  { concepto: 'caseta', monto: 1400, folio: 'CA-4471', label: 'Caseta $1,400' },
  // El receptor viene EN el preset (ensayo 14-ago-2026): en el camino real
  // sale del QR/XML de la foto; sin él, el motor —con razón— mandaba la
  // factura a revisión por receptor ilegible y el guion perdía su «única
  // diferencia». Es el RFC de la flota demo, el mismo del seed.
  { concepto: 'factura', monto: 1200, folio: 'FA-9007', cfdiUuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', rfcReceptor: 'GMX0902279I1', label: 'Factura CFDI $1,200' },
];


export default function Demo() {
  const [bubbles, setBubbles] = useState<Bubble[]>([
    { from: 'likida', text: `¡Hola! Soy Likida. Ya casi cierras tu viaje Silao → Laredo (anticipo ${mxn(ANTICIPO)}). Mándame las fotos de tus comprobantes.` },
  ]);
  const [added, setAdded] = useState<Comprobante[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll al último mensaje cuando entra una burbuja nueva. ME-16.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [bubbles]);

  const add = (c: Comprobante) => {
    setAdded((a) => [...a, c]);
    setBubbles((b) => [
      ...b,
      { from: 'op', text: `📎 ${c.label}` },
      { from: 'likida', text: `Recibí tu ${c.concepto} de ${mxn(c.monto)}${c.cfdiUuid ? ' (CFDI validado por QR ✅)' : ''}. ¿Tienes más o ya cerramos?` },
    ]);
  };

  const cerrar = async () => {
    setLoading(true);
    setBubbles((b) => [...b, { from: 'op', text: 'Ya no tengo más, ciérralo' }]);
    try {
      const res = await fetch('/api/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comprobantes: added, anticipo: ANTICIPO }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = await res.json();
      const lines: string[] = [
        `Listo, cuadré tu viaje 👇`,
        `• Comprobado: ${mxn(r.totalComprobado)}`,
        `• Anticipo: ${mxn(r.totalAnticipo)}`,
        r.diferencia > 0 ? `• Sobró ${mxn(r.diferencia)} (a favor de la empresa)` : r.diferencia < 0 ? `• Pusiste ${mxn(-r.diferencia)} de tu bolsa` : `• Cuadra exacto ✅`,
      ];
      const obs = r.diferencias.filter((d: { tipo: string }) => d.tipo !== 'anticipo');
      setBubbles((b) => [...b, { from: 'likida', text: lines.join('\n') }]);
      if (obs.length) {
        setBubbles((b) => [...b, { from: 'likida', text: 'Ojo con esto:\n' + obs.map((d: { nota: string }) => `• ${d.nota}`).join('\n') }]);
      }
      setBubbles((b) => [...b, { from: 'likida', text: '📄 Así te llegaría tu liquidación en PDF cuando cierres tu viaje. ¡Buen viaje! 🚛' }]);
    } catch {
      // ME-16: si el cuadre falla (red/servidor), avisar en vez de colgar el demo.
      setBubbles((b) => [...b, { from: 'likida', text: 'Uy, no pude cerrar el cuadre ahorita. Inténtalo de nuevo en un momento.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <MarcoPublico
      rotulo="Demo"
      titulo="Demo — Likida por WhatsApp"
      apoyo="Simula al operador mandando sus comprobantes. El cuadre es real."
      ancho="estrecho"
    >
      {/* Teléfono */}
      <div className="rv-demo" role="region" aria-label="Conversación de ejemplo">
        <div className="rv-demo__cab">
          <div className="rv-demo__avatar" aria-hidden="true">L</div>
          <div>
            <div className="rv-demo__nombre">Likida</div>
            <div className="rv-pub__nota">en línea</div>
          </div>
        </div>

        <div ref={scrollRef} className="rv-demo__hilo" aria-live="polite">
          {bubbles.map((b, i) => (
            <div key={i} className="rv-demo__fila" data-de={b.from}>
              <div className="rv-demo__burbuja" data-de={b.from}>{b.text}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Controles */}
      <div className="rv-pub__acciones">
        {PRESETS.map((p, i) => (
          <Boton key={i} tamano="sm" onClick={() => add(p)}>{p.label}</Boton>
        ))}
      </div>
      <div className="rv-pub__acciones">
        <Boton variante="primary" onClick={cerrar} disabled={loading || !added.length} loading={loading}>
          {loading ? 'Cuadrando…' : 'Ya no tengo más — cerrar liquidación'}
        </Boton>
      </div>
    </MarcoPublico>
  );
}
