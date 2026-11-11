import { Upload, Trash2 } from 'lucide-react';
import { numero } from '@/lib/formato';
// SOLO tipos: el módulo de datos importa supabaseAdmin y no debe entrar al bundle de la vista.
import type { ReglaCasetaVista, TagBajaVista, ExcepcionUnidadVista } from '@/lib/likida/peajes/revision_cobros';
import { Tarjeta, Icono, Boton } from '@/app/ui-v2/componentes';
import '../peajes.css';
import { type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

type Accion = (fd: FormData) => Promise<void>;

export interface AccionesReglasCobro {
  guardarReglaCaseta: Accion; cargarCoordenadas: Accion; altaBajaTag: Accion; quitarBajaTag: Accion;
  /** Excepciones por unidad de las casetas que no deben cruzarse (opcionales: sin ellas la sección no se pinta). */
  guardarExcepcionUnidad?: Accion; quitarExcepcionUnidad?: Accion;
}

export interface ReglasCobroVista {
  casetas: ReglaCasetaVista[] | null;
  bajas: TagBajaVista[] | null;
  /** `undefined` = la pantalla no maneja excepciones; `null` = no se pudieron leer. */
  excepciones?: ExcepcionUnidadVista[] | null;
  acciones: AccionesReglasCobro;
}


/** Casetas que se pintan a la vez (el catálogo trae ~115; con reglas primero). */
const MAX_CASETAS_VISIBLES = 200;

/**
 * Las REGLAS DE COBRO de la flota: lo que la revisión de cobros necesita saber y no puede adivinar.
 * NADA viene precargado: ni casetas de tarifa por pasada, ni casetas prohibidas, ni TAGs dados de baja.
 * Los nombres de casetas salen solos del archivo del proveedor; la flota decide qué regla lleva cada una.
 */
export function SeccionReglasCobro({ datos, tr = TR_ES }: { datos: ReglasCobroVista; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const { casetas, bajas, acciones, excepciones } = datos;
  const prohibidas = (casetas ?? []).filter((c) => c.noCruzar);
  const nombrePorNorm = new Map((casetas ?? []).map((c) => [c.nombreNorm, c.nombre]));
  const ordenadas = casetas
    ? [...casetas].sort((a, b) => Number(b.noCruzar || b.clasesPermitidas.length > 0) - Number(a.noCruzar || a.clasesPermitidas.length > 0) || b.crucesVistos - a.crucesVistos)
    : null;
  return (
    <div id="reglas-cobro">
    <Tarjeta titulo={tx('rest.reglas_de_cobro')}>
      <p className="text-[11px] mb-3 rv-pj-c-faint">{ricoT(tx('rest.la_revision_de_cobros_marca_b'), { b: (c) => <b>{c}</b> })}</p>

      {/* sin-info: rótulo de un bloque dentro de la tarjeta */}
      <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-2 rv-pj-c-muted">{tx('rest.casetas_por_nombre')}</h3>
      {ordenadas === null ? (
        <p className="text-[12px] rv-pj-c-muted">{tx('rest.no_se_pudo_leer_el_catalogo_4')}</p>
      ) : ordenadas.length === 0 ? (
        <p className="text-[12px] mb-2 rv-pj-c-muted">{tx('rest.aun_no_hay_casetas_aparecen_cuando')}</p>
      ) : (
        <div className="space-y-1.5 mb-3">
          {ordenadas.slice(0, MAX_CASETAS_VISIBLES).map((c) => (
            <form key={c.id} action={acciones.guardarReglaCaseta} className="hairline rounded-lg px-2.5 py-2 flex items-center gap-2 flex-wrap text-[12px]">
              <input type="hidden" name="nombre" value={c.nombre} />
              <span className="font-medium min-w-[170px]">{c.nombre}</span>
              <span className="text-[11px] cifra-mono rv-pj-c-faint">{numero(c.crucesVistos)} cruces{c.lat !== null && c.lng !== null ? ` · ${c.lat}, ${c.lng}` : ''}</span>
              <label className="flex items-center gap-1.5 ml-auto">{ricoT(tx('rest.e0_clases_validas_extra_e0'), { e0: (c) => <span className="text-[11px] rv-pj-c-muted">{c}</span> })}<input name="clases" defaultValue={c.clasesPermitidas.join(', ')} placeholder="1" maxLength={60} aria-label={tx('rest.clases_validas_extra_en', { nombre: c.nombre })}
                  className="w-[80px] rv-ctl" />
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" name="no_cruzar" value="1" defaultChecked={c.noCruzar} aria-label={`${c.nombre} no debe cruzarse`} />{ricoT(tx('rest.e0_no_debe_cruzarse_e0'), { e0: (c) => <span className="text-[11px]">{c}</span> })}</label>
              <Boton type="submit" variante="secondary" tamano="sm">{tx('rest.guardar')}</Boton>
            </form>
          ))}
          {ordenadas.length > MAX_CASETAS_VISIBLES && <p className="text-[11px] rv-pj-c-faint">{tx('rest.se_muestran_de', { maxCasetasVisibles: MAX_CASETAS_VISIBLES, length: ordenadas.length })}</p>}
        </div>
      )}
      <p className="text-[11px] mb-3 rv-pj-c-faint">{ricoT(tx('rest.clases_validas_extra_son_clases_que'), { e0: (c) => <span className="cifra-mono">{c}</span> })}</p>

      {excepciones !== undefined && acciones.guardarExcepcionUnidad && acciones.quitarExcepcionUnidad && (
        <div className="mb-4" id="excepciones-unidad">
          {/* sin-info: rótulo de un bloque dentro de la tarjeta */}
          <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-2 rv-pj-c-muted">{tx('rest.unidades_exceptuadas_de_no_debe_cruzarse')}</h3>
          <p className="text-[11px] mb-2 rv-pj-c-faint">{tx('rest.una_unidad_exceptuada_puede_cruzar_esa')}</p>
          {excepciones === null ? (
            <p className="text-[12px] rv-pj-c-muted">{tx('rest.no_se_pudo_leer_la_lista_4')}</p>
          ) : excepciones.length === 0 ? (
            <p className="text-[12px] mb-2 rv-pj-c-muted">{tx('rest.ninguna_unidad_exceptuada')}</p>
          ) : (
            <div className="space-y-1.5 mb-2">
              {excepciones.map((e) => (
                <div key={e.id} className="hairline rounded-lg px-2.5 py-2 flex items-center gap-2 flex-wrap text-[12px]">
                  <span className="font-medium cifra-mono">{e.unidad}</span>{ricoT(tx('rest.e0_puede_cruzar_e0', { v: nombrePorNorm.get(e.casetaNorm) ?? e.casetaNorm }), { e0: (c) => <span>{c}</span> })}{e.nota && <span className="rv-pj-c-muted">· {e.nota}</span>}
                  <form action={acciones.quitarExcepcionUnidad} className="ml-auto">
                    <input type="hidden" name="excepcion" value={e.id} />
                    <Boton type="submit" aria-label={tx('rest.quitar_la_excepcion_de', { unidad: e.unidad })} variante="secondary" tamano="sm"><Icono icono={Trash2} /></Boton>
                  </form>
                </div>
              ))}
            </div>
          )}
          {prohibidas.length === 0 ? (
            <p className="text-[11px] rv-pj-c-faint">{tx('rest.primero_marca_una_caseta_como_no')}</p>
          ) : (
            <form action={acciones.guardarExcepcionUnidad} className="flex items-end gap-2 flex-wrap">
              <label className="block">{ricoT(tx('rest.e0_caseta_e0'), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">{c}</span> })}<select name="caseta" required className="mt-0.5 rv-ctl">
                  {prohibidas.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                </select></label>
              <label className="block">{ricoT(tx('rest.e0_unidad_e0'), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">{c}</span> })}<input name="unidad" required maxLength={40} placeholder="TC9001" className="w-[120px] mt-0.5 rv-ctl" /></label>
              <label className="block">{ricoT(tx('rest.e0_nota_opc_e0'), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">{c}</span> })}<input name="nota" maxLength={300} placeholder={tx('rest.atiende_rescates')} className="w-[200px] mt-0.5 rv-ctl" /></label>
              <Boton type="submit" variante="primary" tamano="sm">{tx('rest.exceptuar_unidad')}</Boton>
            </form>
          )}
        </div>
      )}

      <form action={acciones.cargarCoordenadas} encType="multipart/form-data" className="flex items-center gap-2 flex-wrap mb-4">
        <input type="file" name="archivo" accept=".csv,.tsv" required aria-label={tx('rest.csv_de_coordenadas_de_casetas')}
          className="text-[12px] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-[12px] file:font-medium file:cursor-pointer rv-pj-c-muted" />
        <Boton type="submit" variante="primary" tamano="sm"><Icono icono={Upload} />{' '}{tx('rest.cargar_coordenadas')}</Boton>
        <span className="text-[11px] rv-pj-c-faint">{ricoT(tx('rest.opcional_csv_e0_nombre_lat_lng'), { e0: (c) => <span className="cifra-mono">{c}</span> })}</span>
      </form>

      {/* sin-info: rótulo de un bloque dentro de la tarjeta */}
      <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-2 rv-pj-c-muted">{tx('rest.tags_dados_de_baja')}</h3>
      {bajas === null ? (
        <p className="text-[12px] rv-pj-c-muted">{tx('rest.no_se_pudo_leer_la_lista_5')}</p>
      ) : bajas.length === 0 ? (
        <p className="text-[12px] mb-2 rv-pj-c-muted">{tx('rest.ningun_tag_dado_de_baja')}</p>
      ) : (
        <div className="space-y-1.5 mb-3">
          {bajas.map((b) => (
            <div key={b.id} className="hairline rounded-lg px-2.5 py-2 flex items-center gap-2 flex-wrap text-[12px]">
              <span className="font-medium cifra-mono">{b.tagOriginal ?? b.tag}</span>{ricoT(tx('rest.e0_de_baja_desde_el_e0', { bajaEn: b.bajaEn }), { e0: (c) => <span>{c}</span> })}{b.motivo && <span className="rv-pj-c-muted">· {b.motivo}</span>}
              <form action={acciones.quitarBajaTag} className="ml-auto">
                <input type="hidden" name="baja" value={b.id} />
                <Boton type="submit" aria-label={tx('rest.quitar_la_baja_de', { v: b.tagOriginal ?? b.tag })} variante="secondary" tamano="sm"><Icono icono={Trash2} /></Boton>
              </form>
            </div>
          ))}
        </div>
      )}
      <form action={acciones.altaBajaTag} className="flex items-end gap-2 flex-wrap">
        <label className="block"><span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">TAG</span>
          <input name="tag" required maxLength={60} placeholder={tx('rest.imdm_12345678')} className="w-[160px] mt-0.5 rv-ctl" /></label>
        <label className="block">{ricoT(tx('rest.e0_ultimo_dia_vigente_e0'), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">{c}</span> })}<input type="date" name="baja_en" required className="mt-0.5 rv-ctl rv-ctl--fecha" /></label>
        <label className="block">{ricoT(tx('rest.e0_motivo_opc_e0'), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">{c}</span> })}<input name="motivo" maxLength={300} placeholder={tx('rest.unidad_siniestrada')} className="w-[200px] mt-0.5 rv-ctl" /></label>
        <Boton type="submit" variante="primary" tamano="sm">{tx('rest.dar_de_baja')}</Boton>
      </form>
      <p className="text-[11px] mt-1.5 rv-pj-c-faint">{tx('rest.cualquier_cruce_posterior_a_esa_fecha')}</p>
    </Tarjeta>
    </div>
  );
}
