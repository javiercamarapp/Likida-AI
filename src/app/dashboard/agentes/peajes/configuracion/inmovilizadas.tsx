import { Upload, Trash2 } from 'lucide-react';
import { numero } from '@/lib/formato';
// SOLO tipos: el módulo de datos importa supabaseAdmin y no debe entrar al bundle de la vista.
import type { InmovilizadaVista } from '@/lib/likida/peajes/datos';

type Accion = (fd: FormData) => Promise<void>;

export interface InmovilizadasConfigVista {
  /** `null` = no se pudo leer. */
  ventanas: InmovilizadaVista[] | null;
  puedeEditar: boolean;
  acciones: { cargarInmovilizadas: Accion; quitarInmovilizada: Accion };
}

const CSS_BOTON = 'inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85';
const ESTILO_PRIMARIO = { background: 'var(--marca)', color: 'var(--marca-fg)' } as const;
const CSS_SECUNDARIO = 'hairline text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)]';
const ESTILO_SECUNDARIO = { background: 'var(--surface)', color: 'var(--muted)' } as const;

const MAX_VISIBLES = 60;
const ROTULO_MOTIVO: Record<string, string> = { taller: 'en taller', siniestro: 'siniestrada', baja: 'de baja' };

/**
 * UNIDADES INMOVILIZADAS: la lista de unidades en taller, siniestradas o de baja con sus fechas. Un cruce de un TAG de una
 * unidad inmovilizada es un candidato crítico (puede ser un TAG usado sin la tarjeta). NADA viene precargado. Las unidades se
 * resuelven contra las de la flota (número económico o placas): una unidad que no existe, o que casa con varias, se rechaza con su fila.
 */
export function SeccionInmovilizadas({ datos }: { datos: InmovilizadasConfigVista }) {
  const { ventanas, puedeEditar, acciones } = datos;
  return (
    <section className="card p-4" id="unidades-inmovilizadas">
      <h2 className="font-display text-[15px] font-semibold mb-1">Unidades inmovilizadas</h2>
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
        Unidades en taller, siniestradas o de baja, con sus fechas. Si el TAG de una de ellas cruza una caseta dentro de esa ventana, la revisión de
        cobros lo marca como candidato crítico para validar (no se afirma que haya fraude). Nada viene precargado. Para que el TAG se ligue a la
        unidad, primero deben existir las unidades y el catálogo de TAGs.
      </p>
      {ventanas === null ? (
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>No se pudo leer la lista de unidades inmovilizadas ahora mismo.</p>
      ) : ventanas.length === 0 ? (
        <p className="text-[12px] mb-2" style={{ color: 'var(--muted)' }}>Ninguna unidad inmovilizada declarada: la regla «unidad inmovilizada» no corre.</p>
      ) : (
        <div className="space-y-1.5 mb-3">
          <p className="text-[11px]" style={{ color: 'var(--faint)' }}>{numero(ventanas.length)} ventana(s) declarada(s){ventanas.length > MAX_VISIBLES ? `; se muestran las ${MAX_VISIBLES} más recientes` : ''}.</p>
          {ventanas.slice(0, MAX_VISIBLES).map((v) => (
            <div key={v.id} className="hairline rounded-lg px-2.5 py-2 flex items-center gap-2 flex-wrap text-[12px]">
              <span className="font-medium cifra-mono">{v.unidadEconomico ?? 'unidad sin número'}</span>
              <span>{ROTULO_MOTIVO[v.motivo] ?? v.motivo} desde el {v.desde}{v.hasta ? ` hasta el ${v.hasta}` : ' (sigue inmovilizada)'}</span>
              {v.nota && <span style={{ color: 'var(--muted)' }}>· {v.nota}</span>}
              {puedeEditar && (
                <form action={acciones.quitarInmovilizada} className="ml-auto">
                  <input type="hidden" name="ventana" value={v.id} />
                  <button type="submit" aria-label={`Quitar la ventana de ${v.unidadEconomico ?? 'la unidad'} desde el ${v.desde}`} className={`rv-btn rv-btn--secondary ${CSS_SECUNDARIO}`} style={ESTILO_SECUNDARIO}>
                    <Trash2 width={12} height={12} strokeWidth={2} />
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
      {puedeEditar && (
        <form action={acciones.cargarInmovilizadas} encType="multipart/form-data" className="flex items-center gap-2 flex-wrap">
          <input type="file" name="archivo" accept=".csv,.tsv,.xlsx,.xls" required aria-label="Archivo de unidades inmovilizadas"
            className="text-[12px] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-[12px] file:font-medium file:cursor-pointer" style={{ color: 'var(--muted)' }} />
          <button type="submit" className={`rv-btn rv-btn--primary ${CSS_BOTON}`} style={ESTILO_PRIMARIO}><Upload width={13} height={13} strokeWidth={2} /> Cargar unidades inmovilizadas</button>
          <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
            CSV o Excel con <span className="cifra-mono">unidad; desde; hasta; motivo; nota</span>. <span className="cifra-mono">hasta</span> y <span className="cifra-mono">nota</span> son opcionales
            (sin <span className="cifra-mono">hasta</span> = sigue inmovilizada); <span className="cifra-mono">motivo</span> es taller, siniestro o baja. Repetir el archivo es seguro.
          </span>
        </form>
      )}
    </section>
  );
}
