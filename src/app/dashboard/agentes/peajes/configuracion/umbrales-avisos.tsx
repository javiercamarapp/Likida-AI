import type { ConfigPeajesVista } from '@/lib/likida/peajes/datos';
import {
  PLAZO_MESES_MIN, PLAZO_MESES_MAX, PLAZO_MESES_DEFAULT, AVISO_DIAS_MAX, DIAS_GRACIA_MIN, DIAS_GRACIA_MAX,
} from '@/lib/likida/peajes/config_avisos';
import { MIN_CRUCES_MIN, MIN_CRUCES_MAX, VELOCIDAD_MIN_KMH, VELOCIDAD_MAX_KMH, VENTANA_HORAS_MAX } from '@/lib/likida/peajes/atipicos_config';
import { Tarjeta } from '@/app/ui-v2/componentes';
import '../peajes.css';
import { type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

type Accion = (fd: FormData) => Promise<void>;

export interface AccionesUmbralesAvisos {
  /** Interruptor del detector + umbrales de las tres reglas. */
  guardarUmbrales: Accion;
  /** Plazo de reclamo, días de aviso, recordatorio e interruptores. */
  guardarAvisos: Accion;
  /** Destinatario de los avisos (vacío = solo pantalla). */
  guardarDestinatario: Accion;
}

export interface UmbralesAvisosVista {
  /** `null` = no se pudo leer. */
  config: ConfigPeajesVista | null;
  puedeAdministrar: boolean;
  acciones: AccionesUmbralesAvisos;
}


function Numero({ nombre, etiqueta, valor, min, max, paso, ancho }: { nombre: string; etiqueta: string; valor: number; min: number; max: number; paso?: number; ancho?: string }) {
  return (
    <label className="block">
      <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">{etiqueta}</span>
      <input type="number" name={nombre} defaultValue={valor} min={min} max={max} step={paso ?? 1} required
        className={`${ancho ?? 'w-[110px]'} mt-0.5 rv-ctl`} />
    </label>
  );
}

function Interruptor({ nombre, etiqueta, activo, nota, deshabilitado }: { nombre: string; etiqueta: string; activo: boolean; nota?: string; deshabilitado?: boolean }) {
  return (
    <label className="flex items-start gap-2 text-[12px]">
      <input type="checkbox" name={nombre} value="1" defaultChecked={activo} disabled={deshabilitado} className="mt-0.5" />
      <span>
        <span className="font-medium">{etiqueta}</span>
        {nota && <span className="block text-[11px] rv-pj-c-faint">{nota}</span>}
      </span>
    </label>
  );
}

const SUBTITULO = 'text-[11px] font-semibold uppercase tracking-wide mb-2';

/**
 * UMBRALES Y AVISOS: lo que la flota decide sobre los cruces atípicos, el plazo de reclamo y a quién se avisa.
 * TODO nace APAGADO y sin destinatario: ninguna flota recibe un aviso que no pidió. Sin destinatario, lo
 * que se detecta solo se ve en pantalla.
 */
export function SeccionUmbralesAvisos({ datos, tr = TR_ES }: { datos: UmbralesAvisosVista; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const { config, puedeAdministrar, acciones } = datos;
  return (
    <div id="umbrales-avisos">
    <Tarjeta titulo={tx('rest.umbrales_y_avisos')}>
      <p className="text-[11px] mb-3 rv-pj-c-faint">{ricoT(tx('rest.que_patrones_inusuales_se_senalan_cuanto'), { b: (c) => <b>{c}</b> })}</p>

      {config === null ? (
        <p className="text-[12px] rv-pj-c-muted">{tx('rest.no_se_pudo_leer_la_configuracion_6')}</p>
      ) : !puedeAdministrar ? (
        <p className="text-[12px] rv-pj-c-muted">{tx('rest.solo_quien_administra_la_flota_cambia')}</p>
      ) : (
        <div className="space-y-5">
          <form action={acciones.guardarUmbrales} className="space-y-3" id="umbrales-atipicos">
            {/* sin-info: rótulo de un bloque dentro de la tarjeta */}
            <h3 className={`${SUBTITULO} rv-pj-c-muted`}>{tx('rest.cruces_atipicos')}</h3>
            <Interruptor nombre="activo" etiqueta={tx('rest.buscar_cruces_atipicos_en_cada_archivo')} activo={config.atipicosActivo}
              nota={tx('rest.apagado_de_origen_encendido_el_sistema')} />
            <div className="flex items-end gap-4 flex-wrap">
              <div className="space-y-2">
                <Interruptor nombre="repeticion_activa" etiqueta={tx('rest.misma_caseta_muchas_veces')} activo={config.umbrales.repeticion_caseta.activa} />
                <div className="flex items-end gap-2 flex-wrap">
                  <Numero nombre="repeticion_min" etiqueta={tx('rest.cruces_n')} valor={config.umbrales.repeticion_caseta.minCruces} min={MIN_CRUCES_MIN} max={MIN_CRUCES_MAX} />
                  <Numero nombre="repeticion_horas" etiqueta={tx('rest.en_cuantas_horas_h')} valor={config.umbrales.repeticion_caseta.ventanaHoras} min={1} max={VENTANA_HORAS_MAX} ancho="w-[130px]" />
                </div>
              </div>
              <div className="space-y-2">
                <Interruptor nombre="madrugada_activa" etiqueta={tx('rest.ida_y_vuelta_de_madrugada')} activo={config.umbrales.ida_y_vuelta_madrugada.activa} />
                <Numero nombre="madrugada_min" etiqueta={tx('rest.cruces_minimos')} valor={config.umbrales.ida_y_vuelta_madrugada.minCruces} min={MIN_CRUCES_MIN} max={MIN_CRUCES_MAX} />
              </div>
              <div className="space-y-2">
                <Interruptor nombre="velocidad_activa" etiqueta={tx('rest.velocidad_imposible_entre_casetas')} activo={config.umbrales.secuencia_imposible.activa} />
                <Numero nombre="velocidad_max" etiqueta={tx('rest.velocidad_max_km_h')} valor={config.umbrales.secuencia_imposible.velocidadMaxKmh} min={VELOCIDAD_MIN_KMH} max={VELOCIDAD_MAX_KMH} ancho="w-[140px]" />
              </div>
            </div>
            <button type="submit" className="rv-btn rv-btn--primary">{tx('rest.guardar_umbrales')}</button>
          </form>

          <form action={acciones.guardarAvisos} className="space-y-3" id="plazo-avisos">
            {/* sin-info: rótulo de un bloque dentro de la tarjeta */}
            <h3 className={`${SUBTITULO} rv-pj-c-muted`}>{tx('rest.plazo_de_reclamo_y_recordatorios')}</h3>
            <p className="text-[11px] rv-pj-c-faint">{ricoT(tx('rest.el_proveedor_da_un_plazo_para'), { b: (c) => <b>{c}</b> })}</p>
            <p role="note" className="text-[11px] rv-pj-c-faint">{tx('rest.los_avisos_salen_por_whatsapp_al', { plazoMesesDefault: PLAZO_MESES_DEFAULT })}</p>
            <div className="flex items-end gap-3 flex-wrap">
              <Numero nombre="plazo_meses" etiqueta={tx('rest.plazo_meses')} valor={config.avisos.plazo.meses} min={PLAZO_MESES_MIN} max={PLAZO_MESES_MAX} />
              <label className="block">{ricoT(tx('rest.e0_avisar_cuantos_dias_antes_e0'), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">{c}</span> })}<input name="aviso_dias" defaultValue={config.avisos.plazo.avisoDias.join(', ')} required maxLength={40} placeholder="30, 7"
                  aria-label={tx('rest.dias_de_aviso_antes_del_vencimiento', { avisoDiasMax: AVISO_DIAS_MAX })}
                  className="w-[150px] mt-0.5 rv-ctl" />
              </label>
              <Numero nombre="dias_gracia" etiqueta={tx('rest.gracia_del_archivo_dias')} valor={config.avisos.recordatorio.diasGracia} min={DIAS_GRACIA_MIN} max={DIAS_GRACIA_MAX} ancho="w-[150px]" />
            </div>
            <div className="space-y-2">
              <Interruptor nombre="aviso_plazo" etiqueta={tx('rest.avisar_cuando_un_cobro_sin_reclamar')} activo={config.avisos.interruptores.aviso_plazo}
                nota={tx('rest.un_aviso_por_archivo_y_umbral')} />
              <Interruptor nombre="recordatorio_archivo" etiqueta={tx('rest.recordar_que_falta_el_archivo_de')} activo={config.avisos.interruptores.recordatorio_archivo}
                nota={tx('rest.un_solo_recordatorio_por_decena_pasados')} />
            </div>
            <button type="submit" className="rv-btn rv-btn--primary">{tx('rest.guardar_plazo_y_avisos')}</button>
          </form>

          <form action={acciones.guardarDestinatario} className="space-y-2" id="destinatario-avisos">
            {/* sin-info: rótulo de un bloque dentro de la tarjeta */}
            <h3 className={`${SUBTITULO} rv-pj-c-muted`}>{tx('rest.a_quien_se_avisa')}</h3>
            <div className="flex items-end gap-2 flex-wrap">
              <label className="block">{ricoT(tx('rest.e0_whatsapp_10_a_15_digitos'), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">{c}</span> })}<input name="telefono" defaultValue={config.telefono ?? ''} maxLength={30} placeholder={tx('rest.vacio_solo_en_pantalla')} inputMode="tel"
                  className="w-[220px] mt-0.5 rv-ctl" />
              </label>
              <button type="submit" className="rv-btn rv-btn--primary">{tx('rest.guardar_destinatario')}</button>
            </div>
            <p className="text-[11px] rv-pj-c-faint">
              {config.telefono
                ? tx('rest.los_avisos_que_enciendas_llegan_a')
                : tx('rest.sin_destinatario_nada_se_manda_por')}
            </p>
          </form>
        </div>
      )}
    </Tarjeta>
    </div>
  );
}
