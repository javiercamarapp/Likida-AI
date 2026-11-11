import { Upload } from 'lucide-react';
import { mxn, numero } from '@/lib/formato';
// SOLO tipos: el módulo de datos importa supabaseAdmin y no debe entrar al bundle de la vista.
import type { TarifaVista } from '@/lib/likida/peajes/datos';
import { Tarjeta, Icono } from '@/app/ui-v2/componentes';
import '../peajes.css';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

type Accion = (fd: FormData) => Promise<void>;

export interface AccionesTarifario {
  importarTarifas: Accion;
  /** Confirma una tarifa (hidden `tarifa` = id). */
  confirmarTarifa: Accion;
  /** Busca en el último desglose las casetas donde casi todo es clase 1 (posible «tarifa por pasada»). */
  sugerirPasada?: Accion;
}

export interface TarifarioVista {
  /** `null` = no se pudo leer. */
  tarifas: TarifaVista[] | null;
  acciones: AccionesTarifario;
}


/** Tarifas que se pintan a la vez (el tarifario real son cientos de filas). */
const MAX_TARIFAS_VISIBLES = 300;

const etiquetaOrigen = (tx: TAgentes = TR_ES.t): Record<string, string> => ({
  declarada: tx('rest.declarada_por_la_flota'),
  inferida: tx('rest.inferida_de_los_archivos'),
  proveedor: 'del proveedor',
});

/**
 * El TARIFARIO: cuánto cuesta cruzar cada caseta con cada clase. NADA viene precargado.
 * Solo una tarifa CONFIRMADA puede convertir un candidato en cobro con monto reclamable;
 * una tarifa inferida o declarada se confirma aquí con un clic y queda quién la confirmó.
 */
export function SeccionTarifario({ datos, tr = TR_ES }: { datos: TarifarioVista; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const { tarifas, acciones } = datos;
  const sinConfirmar = tarifas ? tarifas.filter((t) => !t.confirmada).length : 0;
  return (
    <div id="tarifario">
    <Tarjeta titulo={tx('rest.tarifario')}>
      <p className="text-[11px] mb-3 rv-pj-c-faint">{ricoT(tx('rest.cuanto_cuesta_cruzar_cada_caseta_con'), { b: (c) => <b>{c}</b>, e2: (c) => <span className="cifra-mono">{c}</span> })}</p>

      <form action={acciones.importarTarifas} encType="multipart/form-data" className="flex items-center gap-2 flex-wrap">
        <input type="file" name="archivo" accept=".csv,.tsv,.xlsx,.xls,.ods" required aria-label={tx('rest.archivo_de_tarifas')}
          className="text-[12px] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-[12px] file:font-medium file:cursor-pointer rv-pj-c-muted" />
        <label className="flex items-center gap-1.5">{ricoT(tx('rest.e0_este_archivo_es_e0'), { e0: (c) => <span className="text-[11px] rv-pj-c-muted">{c}</span> })}<select name="origen" defaultValue="declarada" className="w-[210px] rv-ctl" aria-label={tx('rest.origen_del_archivo_de_tarifas')}>
            <option value="declarada">{tx('rest.una_tarifa_que_declaro_por_confirmar')}</option>
            <option value="proveedor">{tx('rest.el_tarifario_oficial_del_proveedor_queda')}</option>
          </select>
        </label>
        <button type="submit" className="rv-btn rv-btn--primary"><Icono icono={Upload} />{' '}{tx('rest.cargar_tarifario')}</button>
      </form>

      {tarifas === null ? (
        <p className="text-[12px] mt-3 rv-pj-c-muted">{tx('rest.no_se_pudo_leer_el_tarifario_2')}</p>
      ) : tarifas.length === 0 ? (
        <p className="text-[12px] mt-3 rv-pj-c-muted">{tx('rest.aun_no_hay_tarifas_sin_tarifario')}</p>
      ) : (
        <div className="mt-3 space-y-1 max-h-[360px] overflow-y-auto">
          <p className="text-[11px] rv-pj-c-faint">{tx('rest.tarifas_confirmadas_por_confirmar', { numero: numero(tarifas.length), numero2: numero(tarifas.length - sinConfirmar), numero3: numero(sinConfirmar) })}</p>
          {tarifas.slice(0, MAX_TARIFAS_VISIBLES).map((t) => (
            <div key={t.id} className="hairline rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap text-[12px]">
              <span className="font-medium">{t.casetaNorm}</span>
              <span className="cifra-mono text-[11px] rv-pj-c-muted">clase {t.clase}</span>
              <span className="cifra-mono">{mxn(t.importe)}</span>
              <span className="text-[11px] rv-pj-c-faint">
                desde {t.vigenteDesde}{t.vigenteHasta ? ` hasta ${t.vigenteHasta}` : ' sin fin'} · {etiquetaOrigen(tx)[t.origen] ?? t.origen}
              </span>
              {t.confirmada ? (
                <span className="text-[11px] ml-auto rv-pj-c-ok">{tx('rest.confirmada')}{t.confirmadaPor ? ` por ${t.confirmadaPor}` : ''}</span>
              ) : (
                <form action={acciones.confirmarTarifa} className="ml-auto flex items-center gap-2">{ricoT(tx('rest.e0_por_confirmar_e0'), { e0: (c) => <span className="text-[11px] rv-pj-c-warn">{c}</span> })}<input type="hidden" name="tarifa" value={t.id} />
                  <button type="submit" className="rv-btn rv-btn--secondary" aria-label={tx('rest.confirmar_la_tarifa_de_clase', { casetaNorm: t.casetaNorm, clase: t.clase })}>{tx('rest.confirmar')}</button>
                </form>
              )}
            </div>
          ))}
          {tarifas.length > MAX_TARIFAS_VISIBLES && <p className="text-[11px] rv-pj-c-faint">{tx('rest.se_muestran_de_2', { maxTarifasVisibles: MAX_TARIFAS_VISIBLES, numero: numero(tarifas.length) })}</p>}
        </div>
      )}

      {acciones.sugerirPasada && (
        <form action={acciones.sugerirPasada} className="mt-4">
          <p className="text-[11px] mb-1.5 rv-pj-c-faint">{tx('rest.hay_casetas_con_tarifa_por_pasada')}</p>
          <button type="submit" className="rv-btn rv-btn--secondary">{tx('rest.buscar_sugerencias_en_el_ultimo_desglose')}</button>
        </form>
      )}
    </Tarjeta>
    </div>
  );
}
