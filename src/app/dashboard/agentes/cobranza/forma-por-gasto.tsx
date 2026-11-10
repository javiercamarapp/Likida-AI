'use client';

import { useMemo, useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  validarConfigGasto, armarMensajeGastos, CONCEPTOS_VALIDOS, ROTULO_CONCEPTO_COBRANZA,
  type ConfigGasto, type ItemCobro,
} from '@/lib/likida/agentes/cobranza_gasto_pura';
import type { AccionSimple } from './controles';
import { AvisoCompacto, Boton, Campo, CampoSelect, CampoTexto, Casilla, Fieldset } from '@/app/ui-v2/componentes';
import '../agentes.css';

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
    <div className="rv-ag-notif__rejilla">
      <form action={accion} className="rv-ag-forma">
        <Casilla name="porGasto" checked={porGasto} onChange={(e) => setPorGasto(e.target.checked)} etiqueta="Cobrar por gasto individual"
          ayuda="Apagado, el agente cobra por viaje como siempre. Encendido, un viaje con gastos sin comprobante se cobra por gasto (un solo mensaje por chofer) y el cobro por viaje solo atiende a los viajes sin gastos." />

        <CampoTexto id="cobg-tiers" etiqueta="Cadencia por gasto (días desde que se capturó)" name="tiersGasto" value={tiersTexto}
          onChange={(e) => setTiersTexto(e.target.value)} placeholder="1, 3, 7"
          ayuda="Hasta 5 valores de 1 a 60. A cada gasto se le insiste UNA vez por valor." />

        <div className="rv-ag-par">
          <CampoSelect id="cobg-max" etiqueta="Mensajes por chofer al día" name="maxMensajesDia" value={maxDia} onChange={(e) => setMaxDia(e.target.value)}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </CampoSelect>
          <CampoTexto id="cobg-umbral" etiqueta="Foto ilegible si la lectura es menor a" name="umbralFoto" tipo="number" min={0.1} max={0.95} step={0.05}
            value={umbral} onChange={(e) => setUmbral(e.target.value)} />
        </div>

        <Fieldset leyenda="Conceptos que deben venir con factura (CFDI)">
          <div className="rv-ag-dias">
            {CONCEPTOS_VALIDOS.map((c) => (
              <Casilla key={c} name="conceptosCfdi" value={c} checked={conceptos.includes(c)} onChange={() => alternar(c)} etiqueta={ROTULO_CONCEPTO_COBRANZA[c] ?? c} />
            ))}
          </div>
        </Fieldset>

        <div className="rv-ag-notif__acciones">
          <BotonGuardar />
          {estado?.error && <AvisoCompacto tono="error" resumen={estado.error} />}
        </div>
      </form>

      <Campo
        etiqueta={ejemplo.length > 0 ? 'Así se lee en WhatsApp — con gastos reales de la cola' : 'Así se lee en WhatsApp — con gastos de ejemplo'}
        ayuda={<>La firma y la instrucción son las de la estrategia de arriba. Fuera de la ventana de 24 h de WhatsApp sale la plantilla <span className="cifra-mono">cobranza_gastos_v1</span> (nombre, cuántos gastos y el primero).</>}
      >
        <output className="rv-ag-previa" data-tono={'error' in borrador ? 'warn' : undefined}>
          {'error' in borrador ? borrador.error : armarMensajeGastos(items, firma, instrucciones)}
        </output>
      </Campo>
    </div>
  );
}

function BotonGuardar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} disabled={pending}>
      {pending ? 'Guardando…' : 'Guardar cobranza por gasto'}
    </Boton>
  );
}
