import type { ConfigPeajesVista } from '@/lib/likida/peajes/datos';
import {
  PLAZO_MESES_MIN, PLAZO_MESES_MAX, AVISO_DIAS_MAX, DIAS_GRACIA_MIN, DIAS_GRACIA_MAX,
} from '@/lib/likida/peajes/config_avisos';
import { MIN_CRUCES_MIN, MIN_CRUCES_MAX, VELOCIDAD_MIN_KMH, VELOCIDAD_MAX_KMH, VENTANA_HORAS_MAX } from '@/lib/likida/peajes/atipicos_config';

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

const CSS_BOTON = 'inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85';
const ESTILO_PRIMARIO = { background: 'var(--marca)', color: 'var(--marca-fg)' } as const;
const CSS_INPUT = 'hairline text-[12.5px] px-2.5 py-1.5 rounded-lg';
const ESTILO_INPUT = { background: 'var(--surface)', color: 'var(--ink)' } as const;

function Numero({ nombre, etiqueta, valor, min, max, paso, ancho }: { nombre: string; etiqueta: string; valor: number; min: number; max: number; paso?: number; ancho?: string }) {
  return (
    <label className="block">
      <span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>{etiqueta}</span>
      <input type="number" name={nombre} defaultValue={valor} min={min} max={max} step={paso ?? 1} required
        className={`${CSS_INPUT} ${ancho ?? 'w-[110px]'} mt-0.5`} style={ESTILO_INPUT} />
    </label>
  );
}

function Interruptor({ nombre, etiqueta, activo, nota }: { nombre: string; etiqueta: string; activo: boolean; nota?: string }) {
  return (
    <label className="flex items-start gap-2 text-[12.5px]">
      <input type="checkbox" name={nombre} value="1" defaultChecked={activo} className="mt-0.5" />
      <span>
        <span className="font-medium">{etiqueta}</span>
        {nota && <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>{nota}</span>}
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
export function SeccionUmbralesAvisos({ datos }: { datos: UmbralesAvisosVista }) {
  const { config, puedeAdministrar, acciones } = datos;
  return (
    <section className="card p-4" id="umbrales-avisos">
      <h2 className="font-display text-[15px] font-semibold mb-1">Umbrales y avisos</h2>
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
        Qué patrones inusuales se señalan, cuánto tiempo hay para reclamar y a quién se avisa por WhatsApp. Todo viene <b>apagado</b> y sin
        destinatario: mientras no lo enciendas, no se manda ningún aviso y los casos solo se ven en pantalla. Los avisos son una señal para
        revisar, nunca una acusación.
      </p>

      {config === null ? (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No se pudo leer la configuración ahora mismo.</p>
      ) : !puedeAdministrar ? (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Solo quien administra la flota cambia estos valores.</p>
      ) : (
        <div className="space-y-5">
          <form action={acciones.guardarUmbrales} className="space-y-3" id="umbrales-atipicos">
            <h3 className={SUBTITULO} style={{ color: 'var(--muted)' }}>Cruces atípicos</h3>
            <Interruptor nombre="activo" etiqueta="Buscar cruces atípicos en cada archivo" activo={config.atipicosActivo}
              nota="Apagado de origen. Encendido, el sistema marca patrones inusuales por unidad para que alguien los revise." />
            <div className="flex items-end gap-4 flex-wrap">
              <div className="space-y-2">
                <Interruptor nombre="repeticion_activa" etiqueta="Misma caseta muchas veces" activo={config.umbrales.repeticion_caseta.activa} />
                <div className="flex items-end gap-2 flex-wrap">
                  <Numero nombre="repeticion_min" etiqueta="Cruces (N)" valor={config.umbrales.repeticion_caseta.minCruces} min={MIN_CRUCES_MIN} max={MIN_CRUCES_MAX} />
                  <Numero nombre="repeticion_horas" etiqueta="En cuántas horas (H)" valor={config.umbrales.repeticion_caseta.ventanaHoras} min={1} max={VENTANA_HORAS_MAX} ancho="w-[130px]" />
                </div>
              </div>
              <div className="space-y-2">
                <Interruptor nombre="madrugada_activa" etiqueta="Ida y vuelta de madrugada" activo={config.umbrales.ida_y_vuelta_madrugada.activa} />
                <Numero nombre="madrugada_min" etiqueta="Cruces mínimos" valor={config.umbrales.ida_y_vuelta_madrugada.minCruces} min={MIN_CRUCES_MIN} max={MIN_CRUCES_MAX} />
              </div>
              <div className="space-y-2">
                <Interruptor nombre="velocidad_activa" etiqueta="Velocidad imposible entre casetas" activo={config.umbrales.secuencia_imposible.activa} />
                <Numero nombre="velocidad_max" etiqueta="Velocidad máx. (km/h)" valor={config.umbrales.secuencia_imposible.velocidadMaxKmh} min={VELOCIDAD_MIN_KMH} max={VELOCIDAD_MAX_KMH} ancho="w-[140px]" />
              </div>
            </div>
            <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}>Guardar umbrales</button>
          </form>

          <form action={acciones.guardarAvisos} className="space-y-3" id="plazo-avisos">
            <h3 className={SUBTITULO} style={{ color: 'var(--muted)' }}>Plazo de reclamo y recordatorios</h3>
            <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
              El proveedor da un plazo para reclamar un cobro; <b>aún no está confirmado por escrito</b> ni se sabe desde qué fecha cuenta, por eso es ajustable.
            </p>
            <div className="flex items-end gap-3 flex-wrap">
              <Numero nombre="plazo_meses" etiqueta="Plazo (meses)" valor={config.avisos.plazo.meses} min={PLAZO_MESES_MIN} max={PLAZO_MESES_MAX} />
              <label className="block">
                <span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Avisar cuántos días antes</span>
                <input name="aviso_dias" defaultValue={config.avisos.plazo.avisoDias.join(', ')} required maxLength={40} placeholder="30, 7"
                  aria-label={`Días de aviso antes del vencimiento (de 1 a ${AVISO_DIAS_MAX}, separados por comas)`}
                  className={`${CSS_INPUT} w-[150px] mt-0.5`} style={ESTILO_INPUT} />
              </label>
              <Numero nombre="dias_gracia" etiqueta="Gracia del archivo (días)" valor={config.avisos.recordatorio.diasGracia} min={DIAS_GRACIA_MIN} max={DIAS_GRACIA_MAX} ancho="w-[150px]" />
            </div>
            <div className="space-y-2">
              <Interruptor nombre="aviso_plazo" etiqueta="Avisar cuando un cobro sin reclamar está por vencer" activo={config.avisos.interruptores.aviso_plazo}
                nota="Necesita un destinatario; sin él, el vencimiento solo se ve en pantalla." />
              <Interruptor nombre="recordatorio_archivo" etiqueta="Recordar que falta el archivo de la decena" activo={config.avisos.interruptores.recordatorio_archivo}
                nota="Pasados los días de gracia desde el cierre de una decena sin archivo. Necesita un destinatario." />
            </div>
            <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}>Guardar plazo y avisos</button>
          </form>

          <form action={acciones.guardarDestinatario} className="space-y-2" id="destinatario-avisos">
            <h3 className={SUBTITULO} style={{ color: 'var(--muted)' }}>A quién se avisa</h3>
            <div className="flex items-end gap-2 flex-wrap">
              <label className="block">
                <span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>WhatsApp (10 a 15 dígitos)</span>
                <input name="telefono" defaultValue={config.telefono ?? ''} maxLength={30} placeholder="Vacío = solo en pantalla" inputMode="tel"
                  className={`${CSS_INPUT} w-[220px] mt-0.5`} style={ESTILO_INPUT} />
              </label>
              <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}>Guardar destinatario</button>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
              {config.telefono
                ? 'Los avisos que enciendas llegan a este número. Para dejar de recibirlos, vacía el campo y guarda.'
                : 'Sin destinatario: nada se manda por WhatsApp; los casos solo se ven en pantalla.'}
            </p>
          </form>
        </div>
      )}
    </section>
  );
}
