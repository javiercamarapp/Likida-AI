import { revalidatePath } from 'next/cache';
import { ScrollText, Info, Route } from 'lucide-react';
import { getConfig } from '@/lib/cuadra/config';
import { etiquetaConcepto } from '@/lib/cuadra/cuadre/engine';
import { guardarPolitica, armarPolitica, mensajeParaPantalla } from '@/lib/cuadra/administracion';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { EstadoVacio, StatusPill } from '../../admin/ui/kit';
import { FormaConAviso, type ResultadoAccion, ESTILO_CONTROL } from '../../admin/ui/forma';

export const dynamic = 'force-dynamic';

/** Los conceptos que el motor sabe etiquetar (`label()` en engine.ts). Un
 *  concepto fuera de esta lista no rompe nada, pero tampoco tiene renglón: por
 *  eso los que ya estén guardados se conservan aunque no aparezcan aquí. */
const CONCEPTOS = ['diesel', 'caseta', 'factura', 'alimentacion', 'hospedaje', 'transporte', 'flete', 'viaticos', 'otro'] as const;

/**
 * Políticas (PASO 23) — los topes REALES contra los que el motor cuadra cada
 * viaje de esta flota, leídos de `tenant.config.politica` con `getConfig()`,
 * que es la misma función que usa el motor. No es una pantalla informativa:
 * es la regla que decide si un gasto sale marcado.
 *
 * `politica_gasto` (la tabla) NO se lee aquí a propósito: está MUERTA — su
 * propio comentario en el esquema lo dice, no la lee nadie. Enseñarla haría
 * que el dueño edite mentalmente una regla que el motor no aplica.
 *
 * SE PUEDE EDITAR DESDE AQUÍ (antes se cambiaba con SQL a mano). Dos cuidados
 * que no son obvios:
 *
 *  1. `fusionarConfig` REEMPLAZA los arreglos completos, no los fusiona renglón
 *     por renglón. Así que lo que se guarda es la política entera, y por eso el
 *     formulario tiene que mandar TODOS los renglones vigentes, no solo el que
 *     se tocó.
 *  2. Por (1), las reglas POR RUTA se perderían: este formulario se indexa por
 *     concepto y no tiene dónde ponerlas. Se conservan aparte, verbatim, y se
 *     enseñan como de solo lectura. Borrarle a una flota su tope de casetas de
 *     una ruta concreta —en silencio, por guardar otra cosa— es el tipo de daño
 *     que nadie relaciona con esta pantalla tres semanas después.
 */
export default async function PoliticasPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/politicas', sp);
  const puedeEditar = puedeAdministrar(rol);

  let config;
  try {
    config = await getConfig(tenantId);
  } catch {
    config = null;
  }

  // ¿La política que se ve es SUYA o la heredada de la base? `getConfig` ya las
  // fusionó y no lo distingue, así que se pregunta por la fila cruda. Importa
  // decirlo: al guardar por primera vez, la flota deja de seguir la base.
  let politicaPropia = false;
  if (config) {
    const { data } = await supabaseAdmin().from('tenant').select('config').eq('id', tenantId).maybeSingle();
    const cfg = data?.config as { politica?: unknown } | null;
    politicaPropia = Array.isArray(cfg?.politica);
  }

  const politica = config?.politica ?? [];
  const porRuta = politica.filter((p) => p.ruta);
  const generales = politica.filter((p) => !p.ruta);
  const deConcepto = (c: string) => generales.find((p) => p.concepto === c);

  async function accionGuardar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await requireSessionTenant('/dashboard/politicas');
    if (!puedeAdministrar(s.rol)) {
      return { error: 'Tu rol no puede editar la política de gastos.' };
    }
    let t = s.tenantId;
    if (s.rol === 'superadmin' && sp?.tenant) {
      const { data } = await supabaseAdmin().from('tenant').select('id').eq('id', sp.tenant).maybeSingle();
      if (data) t = data.id as string;
    }

    // `armarPolitica` repone las reglas por ruta, que este formulario no edita
    // y que guardar sin ellas borraría. Vive en administracion.ts porque puede
    // perder datos y eso tiene que estar probado, no confiado a la vista.
    let completa;
    try {
      completa = armarPolitica(
        CONCEPTOS.map((c) => ({
          concepto: c,
          tope: String(fd.get(`tope_${c}`) ?? ''),
          exigeCfdi: fd.get(`cfdi_${c}`) === 'on',
        })),
        porRuta,
      );
      await guardarPolitica(t, completa);
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar la política') };
    }

    revalidatePath('/dashboard/politicas');
    const propios = completa.length - porRuta.length;
    return {
      ok: `Política guardada: ${propios} concepto(s) con regla${porRuta.length > 0 ? `, más ${porRuta.length} por ruta que se conservaron` : ''}. El motor la aplica desde el próximo cuadre.`,
    };
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <ScrollText width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Políticas</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Los topes contra los que el motor cuadra cada viaje de tu flota
          </span>
        </div>
      </header>

      {config === null ? (
        <div className="glass-panel p-8 text-sm" style={{ color: 'var(--muted)' }}>
          No se pudo leer la configuración de esta flota.
        </div>
      ) : (
        <div className="glass-panel overflow-hidden">
          <div className="pt-5 pb-2 px-5 flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
              Topes por concepto
            </h2>
            {!politicaPropia && <StatusPill estado="neutral">Heredada de la base</StatusPill>}
          </div>

          {puedeEditar ? (
            <section className="px-5 pb-5">
              <FormaConAviso accion={accionGuardar} boton="Guardar política" columnas="md:grid-cols-1">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ color: 'var(--muted)' }} className="text-left">
                        <th className="py-2.5 pr-4 font-medium">Concepto</th>
                        <th className="py-2.5 pr-4 font-medium">Tope por comprobante (MXN)</th>
                        <th className="py-2.5 font-medium">Exige factura (CFDI)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CONCEPTOS.map((c) => {
                        const p = deConcepto(c);
                        return (
                          <tr key={c} className="border-t" style={{ borderColor: 'var(--line)' }}>
                            <td className="py-2.5 pr-4 font-medium">
                              <label htmlFor={`tope_${c}`}>{etiquetaConcepto(c)}</label>
                            </td>
                            <td className="py-2.5 pr-4">
                              <input
                                id={`tope_${c}`}
                                name={`tope_${c}`}
                                type="number"
                                step="0.01"
                                min="0"
                                defaultValue={p?.topeMonto ?? ''}
                                placeholder="Sin tope"
                                className="text-sm rounded-lg px-2.5 py-1.5 w-40"
                                style={ESTILO_CONTROL}
                              />
                            </td>
                            <td className="py-2.5">
                              <input
                                id={`cfdi_${c}`}
                                name={`cfdi_${c}`}
                                type="checkbox"
                                defaultChecked={p?.requiereCfdi ?? false}
                                className="w-4 h-4"
                                aria-label={`Exigir CFDI para ${etiquetaConcepto(c)}`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </FormaConAviso>
              <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
                Vacío es <strong>sin tope</strong>; un 0 es <strong>tope de cero</strong> — el concepto deja de
                permitirse. No es lo mismo y el motor los trata distinto.
                {!politicaPropia && ' Esta flota todavía usa la política base: al guardar queda con la suya y deja de seguirla.'}
              </p>
            </section>
          ) : politica.length === 0 ? (
            <div className="px-5 pb-5">
              <EstadoVacio>Esta flota no tiene topes configurados — el motor no marcará nada por política.</EstadoVacio>
            </div>
          ) : (
            <div className="overflow-x-auto mt-1 pb-2">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--muted)' }} className="text-left">
                    <th className="px-5 py-2.5 font-medium">Concepto</th>
                    <th className="px-5 py-2.5 font-medium text-right">Tope por comprobante</th>
                    <th className="px-5 py-2.5 font-medium">Exige factura (CFDI)</th>
                  </tr>
                </thead>
                <tbody>
                  {politica.map((p) => (
                    <tr key={`${p.concepto}-${p.ruta ?? ''}`} className="border-t" style={{ borderColor: 'var(--line)' }}>
                      <td className="px-5 py-3 font-medium">{etiquetaConcepto(p.concepto)}</td>
                      <td className="px-5 py-3 text-right tabular">
                        {p.topeMonto === undefined
                          ? <span style={{ color: 'var(--muted)' }}>Sin tope</span>
                          : mxn(p.topeMonto)}
                      </td>
                      <td className="px-5 py-3">
                        {p.requiereCfdi
                          ? <StatusPill estado="warn">Sí</StatusPill>
                          : <span style={{ color: 'var(--muted)' }}>No</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {porRuta.length > 0 && (
            <section className="px-5 pb-5 pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Route width={15} height={15} strokeWidth={1.75} />
                <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                  Reglas por ruta
                </h2>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {porRuta.map((p) => (
                    <tr key={`${p.concepto}-${p.ruta}`} className="border-t" style={{ borderColor: 'var(--line)' }}>
                      <td className="py-2.5 font-medium">{etiquetaConcepto(p.concepto)}</td>
                      <td className="py-2.5" style={{ color: 'var(--muted)' }}>{p.ruta}</td>
                      <td className="py-2.5 text-right tabular">
                        {p.topeMonto === undefined ? '—' : mxn(p.topeMonto)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                De solo lectura: el editor de arriba trabaja por concepto y no tiene dónde poner la ruta. Se conservan
                intactas al guardar — no se editan desde aquí todavía.
              </p>
            </section>
          )}

          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Topes fiscales que aplica el motor
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <div className="card p-4">
                <div className="text-lg font-semibold tabular">{mxn(config.estimulos.viaticosTopeFiscalDiarioMxn)}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Tope diario de alimentación nacional — LISR Art. 28-V. Lo que exceda sale marcado como no deducible.
                </div>
              </div>
              <div className="card p-4">
                <div className="text-lg font-semibold tabular">{mxn(config.estimulos.efectivoTopeMxn)}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Tope de gasto en efectivo (no combustible) — LISR Art. 27-III. Arriba de esto exige otra forma de pago.
                </div>
              </div>
              <div className="card p-4">
                <div className="text-lg font-semibold tabular">{Math.round(config.estimulos.peajeFactor * 100)}%</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Del gasto de peaje es acreditable — estímulo de autopistas, LIF 2026 Art. 20-A.
                </div>
              </div>
              <div className="card p-4">
                <div className="text-lg font-semibold tabular">{Math.round(config.tabulador.umbralDesviacion * 100)}%</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Desviación de consumo a partir de la cual el motor levanta la mano.
                </div>
              </div>
            </div>
          </section>

          <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <EstadoVacio icono={<Info width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              Los topes fiscales de arriba NO se editan desde aquí: los fija la ley, no la flota. Los viáticos por
              ruta/día y el plazo de comprobación del anticipo tampoco están en el esquema como reglas configurables.
            </EstadoVacio>
          </div>
        </div>
      )}
    </div>
  );
}
