'use client';

import { useState } from 'react';

interface Comprobante { concepto: string; monto: number; folio?: string; cfdiUuid?: string; label: string }
interface Bubble { from: 'op' | 'cuadra'; text: string }

const ANTICIPO = 8000;
const PRESETS: Comprobante[] = [
  { concepto: 'diesel', monto: 2900, folio: 'DS-4471', label: '⛽ Diésel $2,900' },
  { concepto: 'caseta', monto: 850, folio: 'CA-1180', label: '🛣️ Caseta $850' },
  { concepto: 'factura', monto: 1500, folio: 'FA-9002', cfdiUuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', label: '🧾 Factura CFDI $1,500' },
  { concepto: 'diesel', monto: 3400, folio: 'DS-4472', label: '⛽ Diésel $3,400 (sobre tope)' },
  { concepto: 'factura', monto: 600, folio: 'FA-9003', label: '🧾 Factura $600 (sin CFDI)' },
];

const mxn = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export default function Demo() {
  const [bubbles, setBubbles] = useState<Bubble[]>([
    { from: 'cuadra', text: `¡Hola! Soy Cuadra. Ya casi cierras tu viaje Silao → Laredo (anticipo ${mxn(ANTICIPO)}). Mándame las fotos de tus comprobantes. 📸` },
  ]);
  const [added, setAdded] = useState<Comprobante[]>([]);
  const [loading, setLoading] = useState(false);

  const add = (c: Comprobante) => {
    setAdded((a) => [...a, c]);
    setBubbles((b) => [
      ...b,
      { from: 'op', text: `📎 ${c.label}` },
      { from: 'cuadra', text: `Recibí tu ${c.concepto} de ${mxn(c.monto)}${c.cfdiUuid ? ' (CFDI validado por QR ✅)' : ''}. ¿Tienes más o ya cerramos?` },
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
      const r = await res.json();
      const lines: string[] = [
        `Listo, cuadré tu viaje 👇`,
        `• Comprobado: ${mxn(r.totalComprobado)}`,
        `• Anticipo: ${mxn(r.totalAnticipo)}`,
        r.diferencia > 0 ? `• Sobró ${mxn(r.diferencia)} (a favor de la empresa)` : r.diferencia < 0 ? `• Pusiste ${mxn(-r.diferencia)} de tu bolsa` : `• Cuadra exacto ✅`,
      ];
      const obs = r.diferencias.filter((d: { tipo: string }) => d.tipo !== 'anticipo');
      setBubbles((b) => [...b, { from: 'cuadra', text: lines.join('\n') }]);
      if (obs.length) {
        setBubbles((b) => [...b, { from: 'cuadra', text: 'Ojo con esto:\n' + obs.map((d: { nota: string }) => `• ${d.nota}`).join('\n') }]);
      }
      setBubbles((b) => [...b, { from: 'cuadra', text: '📄 Te mando tu liquidación en PDF. ¡Buen viaje! 🚛' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center py-10 px-4">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Demo — Cuadra por WhatsApp</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Simula al operador mandando sus comprobantes. El cuadre es real.</p>
      </div>

      {/* Teléfono */}
      <div className="w-full max-w-sm card overflow-hidden flex flex-col" style={{ height: 560 }}>
        <div className="glass px-4 py-3 border-b flex items-center gap-3" style={{ borderColor: 'var(--line)' }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold" style={{ background: 'var(--accent)' }}>C</div>
          <div>
            <div className="text-sm font-medium">Cuadra</div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>en línea</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ background: 'color-mix(in srgb, var(--muted) 6%, transparent)' }}>
          {bubbles.map((b, i) => (
            <div key={i} className={`flex ${b.from === 'op' ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-line"
                style={b.from === 'op'
                  ? { background: 'var(--accent)', color: '#fff', borderBottomRightRadius: 4 }
                  : { background: 'var(--surface)', border: '1px solid var(--line)', borderBottomLeftRadius: 4 }}>
                {b.text}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Controles */}
      <div className="w-full max-w-sm mt-4 flex flex-wrap gap-2 justify-center">
        {PRESETS.map((p, i) => (
          <button key={i} onClick={() => add(p)}
            className="text-xs px-3 py-1.5 rounded-full hairline hover:opacity-70">{p.label}</button>
        ))}
      </div>
      <button onClick={cerrar} disabled={loading || !added.length}
        className="mt-4 px-5 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40"
        style={{ background: 'var(--accent)', color: '#fff' }}>
        {loading ? 'Cuadrando…' : 'Ya no tengo más — cerrar liquidación'}
      </button>
    </div>
  );
}
