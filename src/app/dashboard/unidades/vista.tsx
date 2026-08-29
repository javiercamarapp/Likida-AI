import { Truck, ShieldAlert, ShieldCheck, Clock, CircleDashed, Wrench, Satellite } from 'lucide-react';
import type { UnidadRow, UnidadCruda } from '@/lib/likida/operacion';
import { clasificarVigencia, contarVigencias, avisoVigencias, type EstadoVigencia } from '@/lib/likida/vigencias';
import { numero } from '@/lib/formato';
import Link from 'next/link';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { paginarRegistro, urlRegistro, type ParamsRegistro } from '../paginar-registro';
import { FiltroRegistro } from '../registro-filtro';
import { BarraPagina } from '../resumen-visual';
// El Plegable es el mismo `<details>` de clientes — no hay una segunda
// librería de UI, y un plegable propio sería su segunda copia.
import { Plegable } from '../clientes/forma';
import { FormaUnidad, type AccionForma, type ProveedorGps } from './forma';
import { AccionesEstadoUnidad, ReactivarUnidad, type AccionEstado } from './estado';

const PILL: Record<EstadoVigencia, { fg: string; bg: string; Icono: typeof ShieldCheck }> = {
  vencido: { fg: 'var(--bad)', bg: 'var(--badbg)', Icono: ShieldAlert },
  por_vencer: { fg: 'var(--warn)', bg: 'var(--warnbg)', Icono: Clock },
  vigente: { fg: 'var(--ok)', bg: 'var(--okbg)', Icono: ShieldCheck },
  sin_dato: { fg: 'var(--muted)', bg: 'var(--canvas)', Icono: CircleDashed },
};

/** Los estados que `unidad.estado` admite, en palabras de persona. La fuente
 *  es `ESTADOS_UNIDAD` de `operacion.ts` (el mismo dominio que el servidor
 *  valida); aquí solo se re-declara el tipo para no arrastrar ese módulo —con
 *  su `supabaseAdmin`— al bundle del navegador. */
const ESTADO_UNIDAD: Record<string, string> = {
  disponible: 'Disponible',
  en_ruta: 'En ruta',
  taller: 'En taller',
  baja: 'Dada de baja',
};

/**
 * EL REGISTRO DE UNIDADES — el activo que produce el dinero, con los papeles
 * que la ley le exige para poder producirlo.
 *
 * Es el patrón de "vigencias que anclan" aplicado a la unidad, y en carga
 * pesa más: una unidad con la verificación
 * vencida no tiene un pendiente administrativo, tiene un riesgo de multa, de
 * detención y de un seguro que no responde.
 *
 * El motor ya existía entero (`getUnidades`): elige el papel MÁS PRÓXIMO a
 * vencer de los tres y devuelve los días, negativos si ya pasó. Esta pantalla
 * solo lo dice, y lo dice con las mismas palabras que `/dashboard/operadores`
 * usa para las licencias, porque el clasificador es el mismo módulo.
 *
 * SIN DATO NO ES VIGENTE, y por eso tiene su propia pastilla gris y su propio
 * contador: una unidad a la que nadie le capturó la póliza no está en regla,
 * está sin verificar. Pintarla verde es la mentira que el gerente descubriría
 * cuando lo pare un inspector.
 */
/** Lo capturado de una unidad, en la forma cruda que la forma edita. */
function aInicial(u: UnidadRow): UnidadCruda {
  return {
    numeroEconomico: u.numeroEconomico,
    placas: u.placas ?? '',
    marca: u.marca ?? '',
    modelo: u.modelo ?? '',
    anio: u.anio == null ? '' : String(u.anio),
    polizaVence: u.polizaVence ?? '',
    permisoSictVence: u.permisoSictVence ?? '',
    verificacionVence: u.verificacionVence ?? '',
    gpsProveedor: u.gpsProveedor ?? '',
    gpsDeviceId: u.gpsDeviceId ?? '',
  };
}

const INICIAL_VACIO: UnidadCruda = {
  numeroEconomico: '', placas: '', marca: '', modelo: '', anio: '',
  polizaVence: '', permisoSictVence: '', verificacionVence: '',
  gpsProveedor: '', gpsDeviceId: '',
};

/**
 * FE-12 (22-ago-2026): esta vista pintaba TODAS las unidades activas y, por
 * cada una, un `<FormaUnidad>` completo dentro de un `<details>`. Con 5,000
 * unidades eso son 5,000 formularios —ocho `<input>` cada uno— en el HTML de
 * una pantalla donde se edita UNA: megabytes servidos para nada, sin búsqueda
 * ni páginas por las que navegar.
 *
 * Ahora: `?q=` y `?p=` acotan lo que se pinta (`paginarRegistro`), y la forma
 * de edición existe SOLO para la fila que `?editar=<id>` nombra. Las demás
 * llevan un link — que es lo que un `<details>` cerrado siempre debió ser.
 */
export function VistaUnidades({ unidades, puedeEditar, guardar, cambiarEstado, sp, sufijo, camposOcultos, proveedoresGps }: {
  unidades: readonly UnidadRow[];
  /** Si se PINTA la captura. La puerta real vive dentro del server action. */
  puedeEditar: boolean;
  guardar: AccionForma;
  /** Mover el estado operativo: taller, baja, o de vuelta a disponible
   *  (auditoría 20, H4). Misma puerta que `guardar`. */
  cambiarEstado: AccionEstado;
  /** El catálogo de rastreo, ya recortado a `{id, nombre}` en el servidor. */
  proveedoresGps: ProveedorGps[];
  /** `?q=`/`?p=`/`?editar=` ya leídos por la página. */
  sp: ParamsRegistro;
  /** `?tenant=`/`?vista=`/`?rol=` del superadmin. */
  sufijo: string;
  camposOcultos: Array<[string, string]>;
}) {
  const activas = unidades.filter((u) => u.activo);
  // AUDITORÍA 20 (H4): las bajas ya no se pierden. Esta vista SIEMPRE filtró
  // `activo`, así que hasta hoy una unidad inactiva desaparecía de la pantalla
  // sin dejar rastro — y como nada la podía inactivar, el hueco nunca se notó.
  // Ahora que la baja existe, tiene que existir también el camino de vuelta:
  // un camión que se vendió y no se vendió, o una baja tecleada por error, no
  // pueden requerir SQL para deshacerse.
  const dadasDeBaja = unidades.filter((u) => !u.activo);
  const conteo = contarVigencias(activas);
  const aviso = avisoVigencias(conteo);

  // El orden es el del trabajo: primero lo vencido, luego lo que va a vencer,
  // y hasta el final lo que está en regla. Ordenar por número económico
  // escondería el problema en la fila 40.
  const PESO: Record<EstadoVigencia, number> = { vencido: 0, por_vencer: 1, sin_dato: 2, vigente: 3 };
  const ordenadas = [...activas].sort((a, b) => {
    const va = clasificarVigencia(a.diasAlVencimiento, a.queVence);
    const vb = clasificarVigencia(b.diasAlVencimiento, b.queVence);
    if (PESO[va.estado] !== PESO[vb.estado]) return PESO[va.estado] - PESO[vb.estado];
    // Dentro del mismo estado, lo más urgente primero.
    return (a.diasAlVencimiento ?? 1e9) - (b.diasAlVencimiento ?? 1e9);
  });

  // FE-12: qué se pinta. El orden de arriba (lo vencido primero) se conserva
  // dentro de la página; la búsqueda cubre económico, placas, marca y modelo,
  // que es como un jefe de tráfico llama a una unidad.
  const pag = paginarRegistro(
    ordenadas,
    (u) => [u.numeroEconomico, u.placas, u.marca, u.modelo].filter(Boolean).join(' '),
    sp,
    (u) => u.id,
  );

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Truck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Unidades"
        />

        <div className="px-5 py-5 flex-1 space-y-3">
          {aviso && (
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl"
              style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
              <ShieldAlert width={16} height={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-medium">Papeles que requieren atención</p>
                <p className="text-[12.5px] mt-0.5">{aviso}</p>
              </div>
            </div>
          )}

          {/* El alta va ANTES del estado vacío a propósito: con cero unidades,
              esta sección es la única forma de que deje de haber cero. Solo se
              pinta a quien puede administrar — el encargado la lee, no la
              escribe (misma puerta que clientes). */}
          {puedeEditar && (
            <section className="card p-4">
              <h2 className="font-display text-[14px] font-semibold mb-1">Dar de alta una unidad</h2>
              <p className="text-[11px] mb-2" style={{ color: 'var(--faint)' }}>
                Con sus vigencias capturadas, Likida avisa qué papel vence primero.
              </p>
              <Plegable resumen="Capturar unidad">
                <FormaUnidad accion={guardar} inicial={INICIAL_VACIO} idPrefijo="alta" proveedoresGps={proveedoresGps} />
              </Plegable>
            </section>
          )}

          {/* `unidades` y no `activas`: con todo el parque dado de baja,
              "todavía no hay unidades dadas de alta" sería falso — y mandaría
              a capturar de nuevo camiones que ya están en la base, abajo. */}
          {unidades.length === 0 ? (
            <EstadoVacio icono={<Truck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              Todavía no hay unidades dadas de alta. Cuando registres tus tractocamiones con su póliza,
              permiso SICT y verificación, aquí se ve cuál está por vencer antes de que te pare un inspector.
            </EstadoVacio>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {([
                  ['Vencidos', conteo.vencidos, 'var(--bad)'],
                  [`Vencen en 30 días`, conteo.porVencer, 'var(--warn)'],
                  ['En regla', conteo.vigentes, 'var(--ok)'],
                  ['Sin papeles', conteo.sinDato, 'var(--muted)'],
                ] as const).map(([rotulo, n, color]) => (
                  <div key={rotulo} className="card p-3.5">
                    <div className="text-[20px] font-semibold tabular" style={{ color: n > 0 ? color : 'var(--muted)' }}>
                      {numero(n)}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>{rotulo}</div>
                  </div>
                ))}
              </div>

              <FiltroRegistro ruta="/dashboard/unidades" sufijo={sufijo} pagina={pag}
                sustantivo="unidades" camposOcultos={camposOcultos} />

              {pag.filas.length === 0 && (
                <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                  Ninguna unidad coincide con «{pag.q}».
                </p>
              )}

              {pag.filas.map((u) => {
                const v = clasificarVigencia(u.diasAlVencimiento, u.queVence);
                const p = PILL[v.estado];
                return (
                  <section key={u.id} className="card p-4">
                    <div className="flex items-start gap-3">
                      <p.Icono width={16} height={16} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: p.fg }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="font-display text-[14px] font-semibold">{u.numeroEconomico}</h2>
                          {u.placas && (
                            <span className="text-[12px] cifra-mono" style={{ color: 'var(--muted)' }}>{u.placas}</span>
                          )}
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
                            style={{ color: 'var(--muted)', background: 'var(--canvas)' }}>
                            {ESTADO_UNIDAD[u.estado] ?? u.estado}
                          </span>
                        </div>

                        {(u.marca || u.modelo || u.anio) && (
                          <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--muted)' }}>
                            {[u.marca, u.modelo, u.anio].filter(Boolean).join(' · ')}
                          </p>
                        )}

                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                            style={{ color: p.fg, background: p.bg }}>
                            {v.rotulo}
                          </span>
                          {u.ordenesAbiertas > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                              style={{ color: 'var(--warn)', background: 'var(--warnbg)' }}>
                              <Wrench width={11} height={11} strokeWidth={1.75} />
                              {u.ordenesAbiertas === 1 ? '1 orden abierta' : `${u.ordenesAbiertas} órdenes abiertas`}
                            </span>
                          )}
                          {u.kmActual !== null && (
                            <span className="text-[11px] cifra-mono" style={{ color: 'var(--faint)' }}>
                              {numero(u.kmActual)} km
                            </span>
                          )}
                          {/* El GPS a la vista en la fila: «ligada» y «entrando»
                              son cosas distintas y se pintan distinto. Sin
                              dispositivo no se dice nada — no toda flota tiene
                              rastreo y un «sin GPS» en cada renglón sería ruido. */}
                          {u.gpsDeviceId && (
                            <span className="text-[11px] inline-flex items-center gap-1"
                              style={{ color: u.gpsVistoEn ? 'var(--ok)' : 'var(--muted)' }}>
                              <Satellite width={11} height={11} strokeWidth={2} />
                              {u.gpsProveedor}
                              {/* La FECHA y no «al día»: `gps_visto_en` puede ser
                                  de hace tres semanas, y «conectado» a secas
                                  taparía justo a la unidad que dejó de reportar. */}
                              {u.gpsVistoEn ? ` · última posición ${u.gpsVistoEn.slice(0, 10)}` : ' · ligada, sin posición todavía'}
                            </span>
                          )}
                        </div>

                        {/* UNA forma de edición por página, la de `?editar=`.
                            Antes cada fila traía la suya plegada: 5,000
                            formularios servidos para escribir en uno. */}
                        {puedeEditar && (
                          pag.editando === u.id ? (
                            <div className="mt-3">
                              <FormaUnidad accion={guardar} id={u.id} inicial={aInicial(u)} idPrefijo={`u-${u.id}`}
                                proveedoresGps={proveedoresGps} gpsVistoEn={u.gpsVistoEn} />
                              <Link href={urlRegistro('/dashboard/unidades', sufijo, { q: pag.q || null, p: pag.pagina, editar: null })}
                                className="inline-block mt-2 text-[12px] underline hover:opacity-70 transition-opacity"
                                style={{ color: 'var(--muted)' }}>
                                Cerrar
                              </Link>
                            </div>
                          ) : (
                            <Link href={urlRegistro('/dashboard/unidades', sufijo, { q: pag.q || null, p: pag.pagina, editar: u.id })}
                              className="inline-block mt-3 text-[12px] underline hover:opacity-70 transition-opacity"
                              style={{ color: 'var(--muted)' }}>
                              Editar unidad
                            </Link>
                          )
                        )}

                        {/* El estado operativo NO vive en la forma de edición:
                            es una acción de un clic sobre un hecho del mundo
                            ("se fue al taller", "la vendimos"), no un campo que
                            se captura junto a las placas. Va siempre visible,
                            no solo en la fila que `?editar=` abrió. */}
                        {puedeEditar && (
                          <AccionesEstadoUnidad accion={cambiarEstado} unidadId={u.id} estado={u.estado} />
                        )}
                      </div>
                    </div>
                  </section>
                );
              })}

              <p className="text-[11px] pt-1" style={{ color: 'var(--faint)' }}>
                Se avisa del papel MÁS próximo a vencer de los tres (póliza, permiso SICT, verificación).
                Una unidad sin fecha capturada sale como &quot;sin papeles&quot;, no como vigente — no sabemos
                si está en regla, y decir que sí sería inventarlo.
              </p>
            </>
          )}

          {/* ── LAS QUE YA NO ESTÁN EN EL PARQUE ────────────────────────────
              Aparte y al final: no cuentan en los cuatro contadores de arriba
              (una póliza vencida de un camión vendido no es un pendiente) ni
              se ofrecen en Despacho. Pero SE VEN — un activo dado de baja que
              desaparece de la pantalla se lee como borrado, y no lo está: su
              historial de viajes y de taller sigue completo. */}
          {dadasDeBaja.length > 0 && (
            <section className="card p-4">
              <h2 className="font-display text-[14px] font-semibold mb-1">
                Dadas de baja ({dadasDeBaja.length})
              </h2>
              <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
                Fuera del parque: no se ofrecen para viajes nuevos y no cuentan en los papeles de arriba.
                Su historial se conserva.
              </p>
              <ul className="space-y-2">
                {dadasDeBaja.map((u) => (
                  <li key={u.id} className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <span className="text-[13px] font-medium">{u.numeroEconomico}</span>
                      {u.placas && (
                        <span className="text-[12px] ml-2 cifra-mono" style={{ color: 'var(--muted)' }}>{u.placas}</span>
                      )}
                      {(u.marca || u.modelo || u.anio) && (
                        <p className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
                          {[u.marca, u.modelo, u.anio].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    {puedeEditar && <ReactivarUnidad accion={cambiarEstado} unidadId={u.id} />}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
