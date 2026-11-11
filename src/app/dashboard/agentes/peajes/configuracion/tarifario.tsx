import { Upload } from 'lucide-react';
import { mxn, numero } from '@/lib/formato';
// SOLO tipos: el módulo de datos importa supabaseAdmin y no debe entrar al bundle de la vista.
import type { TarifaVista } from '@/lib/likida/peajes/datos';
import { Tarjeta, Icono } from '@/app/ui-v2/componentes';
import '../peajes.css';

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

const ETIQUETA_ORIGEN: Record<string, string> = {
  declarada: 'declarada por la flota',
  inferida: 'inferida de los archivos',
  proveedor: 'del proveedor',
};

/**
 * El TARIFARIO: cuánto cuesta cruzar cada caseta con cada clase. NADA viene precargado.
 * Solo una tarifa CONFIRMADA puede convertir un candidato en cobro con monto reclamable;
 * una tarifa inferida o declarada se confirma aquí con un clic y queda quién la confirmó.
 */
export function SeccionTarifario({ datos }: { datos: TarifarioVista }) {
  const { tarifas, acciones } = datos;
  const sinConfirmar = tarifas ? tarifas.filter((t) => !t.confirmada).length : 0;
  return (
    <div id="tarifario">
    <Tarjeta titulo="Tarifario">
      <p className="text-[11px] mb-3 rv-pj-c-faint">
        Cuánto cuesta cruzar cada caseta con cada clase de vehículo. <b>Nace vacío a propósito</b>: el proveedor no entrega un catálogo, así que se
        carga uno propio o se confirma el que se infiere de los archivos. Una tarifa sin confirmar <b>no</b> convierte un candidato en cobro indebido;
        solo una confirmada lo hace. Carga tu CSV o Excel con las columnas <span className="cifra-mono">caseta; clase; importe; desde; hasta</span>
        (si no trae «desde», la vigencia empieza hoy). Volver a cargar el mismo archivo es seguro.
      </p>

      <form action={acciones.importarTarifas} encType="multipart/form-data" className="flex items-center gap-2 flex-wrap">
        <input type="file" name="archivo" accept=".csv,.tsv,.xlsx,.xls,.ods" required aria-label="Archivo de tarifas"
          className="text-[12px] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-[12px] file:font-medium file:cursor-pointer rv-pj-c-muted" />
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] rv-pj-c-muted">Este archivo es</span>
          <select name="origen" defaultValue="declarada" className="w-[210px] rv-ctl" aria-label="Origen del archivo de tarifas">
            <option value="declarada">una tarifa que declaro (por confirmar)</option>
            <option value="proveedor">el tarifario oficial del proveedor (queda confirmado)</option>
          </select>
        </label>
        <button type="submit" className="rv-btn rv-btn--primary"><Icono icono={Upload} /> Cargar tarifario</button>
      </form>

      {tarifas === null ? (
        <p className="text-[12px] mt-3 rv-pj-c-muted">No se pudo leer el tarifario ahora mismo.</p>
      ) : tarifas.length === 0 ? (
        <p className="text-[12px] mt-3 rv-pj-c-muted">
          Aún no hay tarifas: sin tarifario confirmado, la revisión de cobros solo marca candidatos sin monto reclamable.
        </p>
      ) : (
        <div className="mt-3 space-y-1 max-h-[360px] overflow-y-auto">
          <p className="text-[11px] rv-pj-c-faint">
            {numero(tarifas.length)} tarifas · {numero(tarifas.length - sinConfirmar)} confirmadas · {numero(sinConfirmar)} por confirmar
          </p>
          {tarifas.slice(0, MAX_TARIFAS_VISIBLES).map((t) => (
            <div key={t.id} className="hairline rounded-lg px-2.5 py-1.5 flex items-center gap-2 flex-wrap text-[12px]">
              <span className="font-medium">{t.casetaNorm}</span>
              <span className="cifra-mono text-[11px] rv-pj-c-muted">clase {t.clase}</span>
              <span className="cifra-mono">{mxn(t.importe)}</span>
              <span className="text-[11px] rv-pj-c-faint">
                desde {t.vigenteDesde}{t.vigenteHasta ? ` hasta ${t.vigenteHasta}` : ' sin fin'} · {ETIQUETA_ORIGEN[t.origen] ?? t.origen}
              </span>
              {t.confirmada ? (
                <span className="text-[11px] ml-auto rv-pj-c-ok">Confirmada{t.confirmadaPor ? ` por ${t.confirmadaPor}` : ''}</span>
              ) : (
                <form action={acciones.confirmarTarifa} className="ml-auto flex items-center gap-2">
                  <span className="text-[11px] rv-pj-c-warn">Por confirmar</span>
                  <input type="hidden" name="tarifa" value={t.id} />
                  <button type="submit" className="rv-btn rv-btn--secondary" aria-label={`Confirmar la tarifa de ${t.casetaNorm}, clase ${t.clase}`}>Confirmar</button>
                </form>
              )}
            </div>
          ))}
          {tarifas.length > MAX_TARIFAS_VISIBLES && <p className="text-[11px] rv-pj-c-faint">Se muestran {MAX_TARIFAS_VISIBLES} de {numero(tarifas.length)}.</p>}
        </div>
      )}

      {acciones.sugerirPasada && (
        <form action={acciones.sugerirPasada} className="mt-4">
          <p className="text-[11px] mb-1.5 rv-pj-c-faint">
            ¿Hay casetas con tarifa por pasada? Revisa el último desglose: te dice dónde casi todos los cruces son clase 1. Es solo una sugerencia; tú la declaras en «Reglas de cobro».
          </p>
          <button type="submit" className="rv-btn rv-btn--secondary">Buscar sugerencias en el último desglose</button>
        </form>
      )}
    </Tarjeta>
    </div>
  );
}
