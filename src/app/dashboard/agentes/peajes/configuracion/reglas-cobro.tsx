import { Upload, Trash2 } from 'lucide-react';
import { numero } from '@/lib/formato';
// SOLO tipos: el módulo de datos importa supabaseAdmin y no debe entrar al bundle de la vista.
import type { ReglaCasetaVista, TagBajaVista, ExcepcionUnidadVista } from '@/lib/likida/peajes/revision_cobros';

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

const CSS_INPUT = 'hairline text-[12.5px] px-2.5 py-1.5 rounded-lg';
const ESTILO_INPUT = { background: 'var(--surface)', color: 'var(--ink)' } as const;
const CSS_BOTON = 'inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85';
const ESTILO_PRIMARIO = { background: 'var(--marca)', color: 'var(--marca-fg)' } as const;
const CSS_SECUNDARIO = 'hairline text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)]';
const ESTILO_SECUNDARIO = { background: 'var(--surface)', color: 'var(--muted)' } as const;

/** Casetas que se pintan a la vez (el catálogo trae ~115; con reglas primero). */
const MAX_CASETAS_VISIBLES = 200;

/**
 * Las REGLAS DE COBRO de la flota: lo que la revisión de cobros necesita saber y no puede adivinar.
 * NADA viene precargado: ni casetas de tarifa por pasada, ni casetas prohibidas, ni TAGs dados de baja.
 * Los nombres de casetas salen solos del archivo del proveedor; la flota decide qué regla lleva cada una.
 */
export function SeccionReglasCobro({ datos }: { datos: ReglasCobroVista }) {
  const { casetas, bajas, acciones, excepciones } = datos;
  const prohibidas = (casetas ?? []).filter((c) => c.noCruzar);
  const nombrePorNorm = new Map((casetas ?? []).map((c) => [c.nombreNorm, c.nombre]));
  const ordenadas = casetas
    ? [...casetas].sort((a, b) => Number(b.noCruzar || b.clasesPermitidas.length > 0) - Number(a.noCruzar || a.clasesPermitidas.length > 0) || b.crucesVistos - a.crucesVistos)
    : null;
  return (
    <section className="card p-4" id="reglas-cobro">
      <h2 className="font-display text-[15px] font-semibold mb-1">Reglas de cobro</h2>
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
        La revisión de cobros marca <b>candidatos para validar con el proveedor</b> (nunca «cobro indebido»). Aquí declaras lo que ella no puede adivinar:
        qué casetas cobran por pasada (clase 1 es normal ahí), qué casetas no deben cruzarse y qué TAGs se dieron de baja. Nada viene precargado.
        Los nombres de las casetas se llenan solos con cada archivo del proveedor.
      </p>

      <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>Casetas por nombre</h3>
      {ordenadas === null ? (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No se pudo leer el catálogo de casetas ahora mismo.</p>
      ) : ordenadas.length === 0 ? (
        <p className="text-[12.5px] mb-2" style={{ color: 'var(--muted)' }}>Aún no hay casetas: aparecen cuando subes el primer archivo del proveedor.</p>
      ) : (
        <div className="space-y-1.5 mb-3">
          {ordenadas.slice(0, MAX_CASETAS_VISIBLES).map((c) => (
            <form key={c.id} action={acciones.guardarReglaCaseta} className="hairline rounded-lg px-2.5 py-2 flex items-center gap-2 flex-wrap text-[12.5px]">
              <input type="hidden" name="nombre" value={c.nombre} />
              <span className="font-medium min-w-[170px]">{c.nombre}</span>
              <span className="text-[11px] cifra-mono" style={{ color: 'var(--faint)' }}>{numero(c.crucesVistos)} cruces{c.lat !== null && c.lng !== null ? ` · ${c.lat}, ${c.lng}` : ''}</span>
              <label className="flex items-center gap-1.5 ml-auto">
                <span className="text-[11px]" style={{ color: 'var(--muted)' }}>Clases válidas extra</span>
                <input name="clases" defaultValue={c.clasesPermitidas.join(', ')} placeholder="1" maxLength={60} aria-label={`Clases válidas extra en ${c.nombre}`}
                  className={`${CSS_INPUT} w-[80px]`} style={ESTILO_INPUT} />
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" name="no_cruzar" value="1" defaultChecked={c.noCruzar} aria-label={`${c.nombre} no debe cruzarse`} />
                <span className="text-[11.5px]">No debe cruzarse</span>
              </label>
              <button type="submit" className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>Guardar</button>
            </form>
          ))}
          {ordenadas.length > MAX_CASETAS_VISIBLES && <p className="text-[11px]" style={{ color: 'var(--faint)' }}>Se muestran {MAX_CASETAS_VISIBLES} de {ordenadas.length}.</p>}
        </div>
      )}
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
        «Clases válidas extra» son clases que, en esa caseta, no se marcan (p. ej. <span className="cifra-mono">1</span> en una caseta de tarifa por pasada); las generales son 3 y 5.
      </p>

      {excepciones !== undefined && acciones.guardarExcepcionUnidad && acciones.quitarExcepcionUnidad && (
        <div className="mb-4" id="excepciones-unidad">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>Unidades exceptuadas de «no debe cruzarse»</h3>
          <p className="text-[11px] mb-2" style={{ color: 'var(--faint)' }}>
            Una unidad exceptuada puede cruzar esa caseta sin que se marque (p. ej. una camioneta de rescates). Las demás unidades siguen marcándose. Nada viene precargado.
          </p>
          {excepciones === null ? (
            <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No se pudo leer la lista de excepciones ahora mismo.</p>
          ) : excepciones.length === 0 ? (
            <p className="text-[12.5px] mb-2" style={{ color: 'var(--muted)' }}>Ninguna unidad exceptuada.</p>
          ) : (
            <div className="space-y-1.5 mb-2">
              {excepciones.map((e) => (
                <div key={e.id} className="hairline rounded-lg px-2.5 py-2 flex items-center gap-2 flex-wrap text-[12.5px]">
                  <span className="font-medium cifra-mono">{e.unidad}</span>
                  <span>puede cruzar {nombrePorNorm.get(e.casetaNorm) ?? e.casetaNorm}</span>
                  {e.nota && <span style={{ color: 'var(--muted)' }}>· {e.nota}</span>}
                  <form action={acciones.quitarExcepcionUnidad} className="ml-auto">
                    <input type="hidden" name="excepcion" value={e.id} />
                    <button type="submit" aria-label={`Quitar la excepción de ${e.unidad}`} className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}><Trash2 width={12} height={12} strokeWidth={2} /></button>
                  </form>
                </div>
              ))}
            </div>
          )}
          {prohibidas.length === 0 ? (
            <p className="text-[11px]" style={{ color: 'var(--faint)' }}>Primero marca una caseta como «No debe cruzarse»; después podrás exceptuar unidades.</p>
          ) : (
            <form action={acciones.guardarExcepcionUnidad} className="flex items-end gap-2 flex-wrap">
              <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Caseta</span>
                <select name="caseta" required className={`${CSS_INPUT} mt-0.5`} style={ESTILO_INPUT}>
                  {prohibidas.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                </select></label>
              <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Unidad</span>
                <input name="unidad" required maxLength={40} placeholder="TC9001" className={`${CSS_INPUT} w-[120px] mt-0.5`} style={ESTILO_INPUT} /></label>
              <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Nota (opc.)</span>
                <input name="nota" maxLength={300} placeholder="Atiende rescates" className={`${CSS_INPUT} w-[200px] mt-0.5`} style={ESTILO_INPUT} /></label>
              <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}>Exceptuar unidad</button>
            </form>
          )}
        </div>
      )}

      <form action={acciones.cargarCoordenadas} encType="multipart/form-data" className="flex items-center gap-2 flex-wrap mb-4">
        <input type="file" name="archivo" accept=".csv,.tsv" required aria-label="CSV de coordenadas de casetas"
          className="text-[12.5px] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-[12.5px] file:font-medium file:cursor-pointer" style={{ color: 'var(--muted)' }} />
        <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}><Upload width={13} height={13} strokeWidth={2} /> Cargar coordenadas</button>
        <span className="text-[11px]" style={{ color: 'var(--faint)' }}>Opcional. CSV <span className="cifra-mono">nombre; lat; lng; fuente</span>. Sin coordenadas la revisión funciona igual; solo no se detectan saltos imposibles entre casetas lejanas. No se inventan.</span>
      </form>

      <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>TAGs dados de baja</h3>
      {bajas === null ? (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No se pudo leer la lista de bajas ahora mismo.</p>
      ) : bajas.length === 0 ? (
        <p className="text-[12.5px] mb-2" style={{ color: 'var(--muted)' }}>Ningún TAG dado de baja.</p>
      ) : (
        <div className="space-y-1.5 mb-3">
          {bajas.map((b) => (
            <div key={b.id} className="hairline rounded-lg px-2.5 py-2 flex items-center gap-2 flex-wrap text-[12.5px]">
              <span className="font-medium cifra-mono">{b.tagOriginal ?? b.tag}</span>
              <span>de baja desde el {b.bajaEn}</span>
              {b.motivo && <span style={{ color: 'var(--muted)' }}>· {b.motivo}</span>}
              <form action={acciones.quitarBajaTag} className="ml-auto">
                <input type="hidden" name="baja" value={b.id} />
                <button type="submit" aria-label={`Quitar la baja de ${b.tagOriginal ?? b.tag}`} className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}><Trash2 width={12} height={12} strokeWidth={2} /></button>
              </form>
            </div>
          ))}
        </div>
      )}
      <form action={acciones.altaBajaTag} className="flex items-end gap-2 flex-wrap">
        <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>TAG</span>
          <input name="tag" required maxLength={60} placeholder="IMDM 12345678" className={`${CSS_INPUT} w-[160px] mt-0.5`} style={ESTILO_INPUT} /></label>
        <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Último día vigente</span>
          <input type="date" name="baja_en" required className={`${CSS_INPUT} mt-0.5`} style={ESTILO_INPUT} /></label>
        <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Motivo (opc.)</span>
          <input name="motivo" maxLength={300} placeholder="Unidad siniestrada" className={`${CSS_INPUT} w-[200px] mt-0.5`} style={ESTILO_INPUT} /></label>
        <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}>Dar de baja</button>
      </form>
      <p className="text-[11px] mt-1.5" style={{ color: 'var(--faint)' }}>Cualquier cruce posterior a esa fecha se marca como candidato. Dar de baja el mismo TAG otra vez cambia su fecha.</p>
    </section>
  );
}
