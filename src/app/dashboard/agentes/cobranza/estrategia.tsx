'use client';

import { useMemo, useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Boton, Campo, CampoSelect, CampoTextarea, CampoTexto, Casilla, AvisoCompacto, Fieldset } from '@/app/ui-v2/componentes';
import '../agentes.css';
import {
  validarConfigCobranza, armarMensajeCobranza, type ConfigCobranza,
} from '@/lib/likida/agentes/cobranza_pura';
import type { AccionSimple } from './controles';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';

const DIAS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * La estrategia del agente, editable, con su vista previa EN VIVO: el texto
 * de la derecha es literalmente `armarMensajeCobranza` — el mismo motor puro
 * que corre el servidor — sobre lo que el formulario trae tecleado. Lo que
 * se ve es lo que sale, sin un segundo armado que pueda divergir.
 *
 * El guardado vive en el servidor y re-valida TODO (`validarConfigCobranza`
 * corre allá también): aquí la validación solo alimenta la vista previa y
 * los avisos tempranos.
 */
export function FormaEstrategia({ config, ejemplo, guardar }: {
  config: ConfigCobranza;
  /** El siguiente REAL de la cola (folio + días juntos, para no enseñar un
   *  folio verdadero con días que no son los suyos). null = cola vacía: la
   *  vista previa se arma como plantilla con el primer tier. */
  ejemplo: { folio: string | null; dias: number } | null;
  guardar: AccionSimple;
}) {
  const { t } = useT('agentes', agentesEs);
  const [estado, accion] = useActionState(guardar, null);
  const [tiersTexto, setTiersTexto] = useState(config.tiers.join(', '));
  const [horaInicio, setHoraInicio] = useState(String(config.horaInicio));
  const [horaFin, setHoraFin] = useState(String(config.horaFin));
  const [dias, setDias] = useState<number[]>(config.diasSemana);
  const [instrucciones, setInstrucciones] = useState(config.instrucciones);
  const [firma, setFirma] = useState(config.firma);

  const borrador = useMemo(() => validarConfigCobranza({
    activo: config.activo,
    tiers: tiersTexto.split(/[,\s]+/).filter(Boolean).map(Number),
    horaInicio: Number(horaInicio),
    horaFin: Number(horaFin),
    diasSemana: dias,
    instrucciones,
    firma,
  }), [config.activo, tiersTexto, horaInicio, horaFin, dias, instrucciones, firma]);

  function alternarDia(iso: number) {
    setDias((v) => (v.includes(iso) ? v.filter((d) => d !== iso) : [...v, iso].sort((a, b) => a - b)));
  }

  return (
    <div className="rv-ag-notif__rejilla">
      <form action={accion} className="rv-ag-forma">
        <CampoTexto id="cob-tiers" etiqueta={t('cobranza.estrategia.tiers_de_insistencia_dias_sin')} name="tiers" value={tiersTexto}
          onChange={(e) => setTiersTexto(e.target.value)} placeholder="3, 7, 14"
          ayuda={t('cobranza.estrategia.hasta_5_valores_de_1')} />

        <div className="rv-ag-par">
          <CampoSelect id="cob-inicio" etiqueta={t('cobranza.estrategia.desde')} name="horaInicio" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
          </CampoSelect>
          <CampoSelect id="cob-fin" etiqueta={t('cobranza.estrategia.hasta')} name="horaFin" value={horaFin} onChange={(e) => setHoraFin(e.target.value)}>
            {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{h}:00</option>)}
          </CampoSelect>
        </div>

        <Fieldset leyenda={t('cobranza.estrategia.dias_permitidos_hora_de_mexico')}>
          <div className="rv-ag-dias">
            {DIAS.map((d) => (
              <Casilla key={d} name="dias" value={d} checked={dias.includes(d)} onChange={() => alternarDia(d)} etiqueta={t(`comun.dia_${d}`)} />
            ))}
          </div>
        </Fieldset>

        <CampoTextarea id="cob-instrucciones" etiqueta={t('cobranza.estrategia.instrucciones_etiqueta', { n: instrucciones.length })} name="instrucciones"
          value={instrucciones} maxLength={300} rows={3} onChange={(e) => setInstrucciones(e.target.value)}
          placeholder={t('cobranza.estrategia.una_linea_tuya_que_viaja')} />

        <CampoTexto id="cob-firma" etiqueta={t('cobranza.estrategia.firma_etiqueta', { n: firma.length })} name="firma" value={firma} maxLength={80} onChange={(e) => setFirma(e.target.value)}
          placeholder={t('cobranza.estrategia.nombre_del_despacho_o_del')} />

        <div className="rv-ag-notif__acciones">
          <BotonGuardar />
          {estado?.error && <AvisoCompacto tono="error" resumen={estado.error} />}
        </div>
      </form>

      {/* La vista previa: el payload literal, no una maqueta */}
      <Campo etiqueta={ejemplo
        ? t('cobranza.estrategia.asi_se_lee_en_whatsapp', { dias: ejemplo.dias })
        : t('cobranza.estrategia.asi_se_lee_en_whatsapp_2')}
        ayuda={t('cobranza.estrategia.los_dias_y_el_folio')}>
        <output className="rv-ag-previa" data-tono={'error' in borrador ? 'warn' : undefined}>
          {'error' in borrador
            ? borrador.error
            : armarMensajeCobranza(ejemplo?.folio ?? null, ejemplo?.dias ?? borrador.ok.tiers[0], borrador.ok)}
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
      {pending ? t('cobranza.estrategia.guardando') : t('cobranza.estrategia.guardar_estrategia')}
    </Boton>
  );
}
