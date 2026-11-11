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
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { rico } from '../i18n-agentes';

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
  const { t } = useT('agentes', agentesEs);
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
        <Casilla name="porGasto" checked={porGasto} onChange={(e) => setPorGasto(e.target.checked)} etiqueta={t('cobranza.formagasto.cobrar_por_gasto_individual')}
          ayuda={t('cobranza.formagasto.apagado_el_agente_cobra_por')} />

        <CampoTexto id="cobg-tiers" etiqueta={t('cobranza.formagasto.cadencia_por_gasto_dias_desde')} name="tiersGasto" value={tiersTexto}
          onChange={(e) => setTiersTexto(e.target.value)} placeholder="1, 3, 7"
          ayuda={t('cobranza.formagasto.hasta_5_valores_de_1')} />

        <div className="rv-ag-par">
          <CampoSelect id="cobg-max" etiqueta={t('cobranza.formagasto.mensajes_por_chofer_al_dia')} name="maxMensajesDia" value={maxDia} onChange={(e) => setMaxDia(e.target.value)}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </CampoSelect>
          <CampoTexto id="cobg-umbral" etiqueta={t('cobranza.formagasto.foto_ilegible_si_la_lectura')} name="umbralFoto" tipo="number" min={0.1} max={0.95} step={0.05}
            value={umbral} onChange={(e) => setUmbral(e.target.value)} />
        </div>

        <Fieldset leyenda={t('cobranza.formagasto.conceptos_que_deben_venir_con')}>
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
        etiqueta={ejemplo.length > 0 ? t('cobranza.formagasto.asi_se_lee_en_whatsapp') : t('cobranza.formagasto.asi_se_lee_en_whatsapp_2')}
        ayuda={<>{rico(t('cobranza.formagasto.la_firma_y_la_instruccion'), { span: <span className="cifra-mono">cobranza_gastos_v1</span> })}</>}
      >
        <output className="rv-ag-previa" data-tono={'error' in borrador ? 'warn' : undefined}>
          {'error' in borrador ? borrador.error : armarMensajeGastos(items, firma, instrucciones)}
        </output>
      </Campo>
    </div>
  );
}

function BotonGuardar() {
  const { t } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} disabled={pending}>
      {pending ? t('cobranza.formagasto.guardando') : t('cobranza.formagasto.guardar_cobranza_por_gasto')}
    </Boton>
  );
}
