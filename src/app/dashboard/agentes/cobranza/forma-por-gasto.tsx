'use client';

import { useMemo, useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  validarConfigGasto, armarMensajeGastos, CONCEPTOS_VALIDOS, ROTULO_CONCEPTO_COBRANZA,
  type ConfigGasto, type ItemCobro,
} from '@/lib/likida/agentes/cobranza_gasto_pura';
import type { AccionSimple } from './controles';

/**
 * La configuración de la cobranza POR GASTO (0525), con su vista previa EN VIVO: el texto de la derecha es
 * literalmente `armarMensajeGastos` —el motor puro que corre el servidor— sobre el primer gasto REAL de la
 * cola (o uno de ejemplo declarado como tal). El guardado vive en el servidor y re-valida todo.
 */
export function FormaPorGasto({ config, ejemplo, firma, instrucciones, guardar }: {
  config: ConfigGasto;
  /** Los gastos reales de la cola de hoy (hasta 2). Vacío = la vista previa se declara ejemplo. */
  ejemplo: readonly ItemCobro[];
  firma: string;
  instrucciones: string;
  guardar: AccionSimple;
}) {
  const [estado, accion] = useActionState(guardar, null);
  const [porGasto, setPorGasto] = useState(config.porGasto);
  const [tiersTexto, setTiersTexto] = useState(config.tiersGasto.join(', '));
  const [maxDia, setMaxDia] = useState(String(config.maxMensajesDia));
  const [umbral, setUmbral] = useState(String(config.umbralFoto));
  const [conceptos, setConceptos] = useState<string[]>(config.conceptosCfdi);

  const borrador = useMemo(() => validarConfigGasto({
    porGasto,
    tiersGasto: tiersTexto.split(/[,\s]+/).filter(Boolean).map(Number),
    maxMensajesDia: Number(maxDia),
    conceptosCfdi: conceptos,
    umbralFoto: Number(umbral),
  }), [porGasto, tiersTexto, maxDia, conceptos, umbral]);

  const items: ItemCobro[] = ejemplo.length > 0 ? [...ejemplo] : [
    { gastoId: 'ej-1', viajeId: 'ej', folioViaje: 'F-1042', operadorNombre: null, concepto: 'diesel', monto: 1200, fecha: null, motivo: 'sin_cfdi', tier: 1, dias: 2 },
    { gastoId: 'ej-2', viajeId: 'ej', folioViaje: 'F-1042', operadorNombre: null, concepto: 'caseta', monto: 85.5, fecha: null, motivo: 'sin_foto', tier: 1, dias: 2 },
  ];

  function alternar(c: string) {
    setConceptos((v) => (v.includes(c) ? v.filter((x) => x !== c) : [...v, c]));
  }

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <form action={accion} className="space-y-3.5">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" name="porGasto" checked={porGasto} onChange={(e) => setPorGasto(e.target.checked)}
            className="mt-0.5" />
          <span className="text-[13px]">
            <span className="font-medium">Cobrar por gasto individual</span>
            <span className="block text-[11.5px]" style={{ color: 'var(--faint)' }}>
              Apagado, el agente cobra por viaje como siempre. Encendido, un viaje con gastos sin comprobante se cobra por gasto
              (un solo mensaje por chofer) y el cobro por viaje solo atiende a los viajes sin gastos.
            </span>
          </span>
        </label>

        <div>
          <label htmlFor="cobg-tiers" className="etiqueta-mono text-[10px] uppercase block mb-1" style={{ color: 'var(--faint)' }}>
            Cadencia por gasto (días desde que se capturó)
          </label>
          <input id="cobg-tiers" name="tiersGasto" value={tiersTexto} onChange={(e) => setTiersTexto(e.target.value)}
            placeholder="1, 3, 7" className="w-full text-[13px] px-3 py-1.5 rounded-lg hairline cifra-mono"
            style={{ background: 'var(--surface)' }} />
          <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
            Hasta 5 valores de 1 a 60. A cada gasto se le insiste UNA vez por valor.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="cobg-max" className="etiqueta-mono text-[10px] uppercase block mb-1" style={{ color: 'var(--faint)' }}>
              Mensajes por chofer al día
            </label>
            <select id="cobg-max" name="maxMensajesDia" value={maxDia} onChange={(e) => setMaxDia(e.target.value)}
              className="w-full text-[13px] px-2.5 py-1.5 rounded-lg hairline" style={{ background: 'var(--surface)' }}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="cobg-umbral" className="etiqueta-mono text-[10px] uppercase block mb-1" style={{ color: 'var(--faint)' }}>
              Foto ilegible si la lectura es menor a
            </label>
            <input id="cobg-umbral" name="umbralFoto" type="number" min={0.1} max={0.95} step={0.05} value={umbral}
              onChange={(e) => setUmbral(e.target.value)}
              className="w-full text-[13px] px-3 py-1.5 rounded-lg hairline cifra-mono" style={{ background: 'var(--surface)' }} />
          </div>
        </div>

        <div>
          <span className="etiqueta-mono text-[10px] uppercase block mb-1" style={{ color: 'var(--faint)' }}>
            Conceptos que deben venir con factura (CFDI)
          </span>
          <div className="flex flex-wrap gap-1.5">
            {CONCEPTOS_VALIDOS.map((c) => {
              const puesto = conceptos.includes(c);
              return (
                <label key={c}
                  className="px-2.5 h-8 rounded-lg hairline flex items-center text-[12px] font-medium cursor-pointer transition-colors"
                  style={puesto
                    ? { background: 'var(--marca)', color: 'var(--marca-fg)', borderColor: 'var(--marca)' }
                    : { background: 'var(--surface)', color: 'var(--muted)' }}>
                  <input type="checkbox" name="conceptosCfdi" value={c} checked={puesto} onChange={() => alternar(c)} className="sr-only" />
                  {ROTULO_CONCEPTO_COBRANZA[c] ?? c}
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <BotonGuardar />
          {estado?.error && <p className="text-[12px]" style={{ color: 'var(--bad)' }}>{estado.error}</p>}
        </div>
      </form>

      <div>
        <div className="etiqueta-mono text-[10px] uppercase mb-1.5" style={{ color: 'var(--faint)' }}>
          {ejemplo.length > 0 ? 'Así se lee en WhatsApp — con gastos reales de la cola' : 'Así se lee en WhatsApp — con gastos de ejemplo'}
        </div>
        {'error' in borrador ? (
          <div className="rounded-xl hairline p-4 text-[12.5px]" style={{ background: 'var(--surface)', color: 'var(--warn)' }}>
            {borrador.error}
          </div>
        ) : (
          <div className="rounded-xl hairline p-4 text-[13px] leading-relaxed whitespace-pre-line" style={{ background: 'var(--surface)' }}>
            {armarMensajeGastos(items, firma, instrucciones)}
          </div>
        )}
        <p className="text-[11px] mt-2" style={{ color: 'var(--faint)' }}>
          La firma y la instrucción son las de la estrategia de arriba. Fuera de la ventana de 24 h de WhatsApp sale la
          plantilla <span className="cifra-mono">cobranza_gastos_v1</span> (nombre, cuántos gastos y el primero).
        </p>
      </div>
    </div>
  );
}

function BotonGuardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="text-[12.5px] font-medium px-3.5 py-1.5 rounded-lg transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      {pending ? 'Guardando…' : 'Guardar cobranza por gasto'}
    </button>
  );
}
