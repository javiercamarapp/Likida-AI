import { revalidatePath } from 'next/cache';
import { UserCog, Wallet, CheckCheck, Users, UserPlus } from 'lucide-react';
import { getOperadoresDetalle, type OperadorDetalle } from '@/lib/cuadra/analytics';
import { crearOperador, mensajeParaPantalla } from '@/lib/cuadra/administracion';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolverTenantPedido } from '@/lib/auth/tenant-api';
import { KpiTile, EstadoVacio, StatusPill } from '../../admin/ui/kit';
import { FormaConAviso, Campo, type ResultadoAccion } from '../../admin/ui/forma';
import { fechaMx } from '../formato';

export const dynamic = 'force-dynamic';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/** Barra de % comprobado — monocromo, con el número al lado: nunca color
 *  solo (regla del skill de dataviz). `null` (nunca recibió anticipo) se
 *  pinta como guion, no como 0%: son cosas distintas. */
function BarraComprobado({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return (
    <div className="flex items-center gap-2 justify-end">
      <div className="h-1.5 rounded-full overflow-hidden shrink-0" style={{ width: 64, background: 'var(--canvas)' }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: 'var(--marca)' }} />
      </div>
      <span className="tabular text-sm w-11 text-right">{pct}%</span>
    </div>
  );
}

/**
 * La licencia (0053).
 *
 * SIN FECHA NO SE MARCA NADA. `null` es "no capturada", no "vencida": pintar de
 * rojo a quien nadie le registró la licencia acusa de ilegal a media plantilla
 * el día que se da de alta una flota. Es el mismo criterio que una factura sin
 * `vence_en` — sin plazo pactado no hay mora.
 */
function Licencia({ o, hoy }: { o: OperadorDetalle; hoy: string }) {
  if (!o.licencia && !o.licenciaVence) {
    return <span style={{ color: 'var(--muted)' }}>Sin registrar</span>;
  }
  const vence = o.licenciaVence;
  const estado = vence === null ? null : vence < hoy ? 'bad' : vence <= en30Dias(hoy) ? 'warn' : 'ok';
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-mono">
        {o.licencia ?? '—'}
        {o.licenciaTipo && <span style={{ color: 'var(--muted)' }}> · {o.licenciaTipo}</span>}
      </span>
      {vence === null ? (
        <span className="text-xs" style={{ color: 'var(--muted)' }}>Sin fecha de vencimiento</span>
      ) : (
        <StatusPill estado={estado!}>
          {estado === 'bad' ? `Vencida ${fechaMx(vence)}` : `Vence ${fechaMx(vence)}`}
        </StatusPill>
      )}
    </div>
  );
}

function en30Dias(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}

/**
 * Operadores (PASO 14) — la tabla real de `operador`, cruzada con su
 * anticipo y lo que comprobaron (`getOperadoresDetalle`, escrita para esta
 * página: `getStatsPorOperador` solo sumaba diésel).
 *
 * ESTA PÁGINA ES DE ÁREA `operacion`, ASÍ QUE EL ENCARGADO ENTRA — y por eso
 * las columnas de dinero se gatean aquí adentro con `puedeVerArea(rol,
 * 'dinero')`. Sin eso era una FUGA: el jefe de tráfico veía anticipo entregado,
 * comprobado y % por chofer, que es justo lo que la matriz de roles (0044) le
 * niega en Cuadre, Rentabilidad y Cobranza. Reclasificar la página entera a
 * `dinero` habría sido peor: el encargado necesita la plantilla —quién está
 * activo, con qué teléfono, con licencia vigente— para poder despachar.
 *
 * La licencia y su vencimiento SÍ existen desde la 0053 y se capturan en el
 * alta de abajo. Lo que sigue sin haber es el scorecard de conducción: necesita
 * telemática o GPS conectado, y no lo hay.
 */
export default async function OperadoresPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/operadores', sp);
  const ops = await safe<OperadorDetalle[]>(() => getOperadoresDetalle(tenantId));

  const veDinero = puedeVerArea(rol, 'dinero');
  const puedeAlta = puedeAdministrar(rol);
  const hoy = new Date().toISOString().slice(0, 10);

  const activos = ops?.filter((o) => o.activo).length ?? 0;
  const anticipoTotal = ops?.reduce((s, o) => s + o.anticipoTotal, 0) ?? 0;
  const comprobadoTotal = ops?.reduce((s, o) => s + o.comprobadoTotal, 0) ?? 0;
  const pctGlobal = anticipoTotal > 0 ? Math.round((comprobadoTotal / anticipoTotal) * 100) : null;

  /**
   * Alta de operador.
   *
   * `requireSessionTenant` va FUERA del try: redirige lanzando (NEXT_REDIRECT),
   * y atraparlo aquí convertiría "no hay sesión" en un aviso rojo dentro de una
   * página que ya no debería estar pintándose.
   *
   * Y repite el permiso adentro, como el resto del panel: el `puedeAlta` de
   * arriba solo decide si se pinta el formulario, y un contador con sesión
   * válida puede armar la petición sin el botón.
   */
  async function accionAlta(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await requireSessionTenant('/dashboard/operadores');
    if (!puedeAdministrar(s.rol)) {
      return { error: 'Tu rol no puede dar de alta operadores. Pídeselo al dueño de la flota.' };
    }

    // El tenant se resuelve OTRA VEZ desde la sesión: un action es su propia
    // petición y el `tenantId` del closure viene del render, no de quien hizo
    // clic. Escribir en el tenant equivocado es el error caro de esta pantalla.
    let t = s.tenantId;
    if (s.rol === 'superadmin' && sp?.tenant) {
      t = await resolverTenantPedido(supabaseAdmin(), t, sp.tenant);
    }

    const nombre = String(fd.get('nombre') ?? '').trim();
    try {
      await crearOperador(t, {
        nombre,
        telefono: String(fd.get('telefono') ?? ''),
        numeroEmpleado: String(fd.get('numeroEmpleado') ?? ''),
        licencia: String(fd.get('licencia') ?? ''),
        licenciaTipo: String(fd.get('licenciaTipo') ?? ''),
        licenciaVence: String(fd.get('licenciaVence') ?? ''),
      });
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'registrar al operador') };
    }

    revalidatePath('/dashboard/operadores');
    return { ok: `${nombre} quedó registrado. Ya puede mandar sus comprobantes por WhatsApp desde ese número.` };
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <UserCog width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Operadores</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {veDinero
              ? 'Quién trae anticipo abierto y qué tanto ha comprobado'
              : 'Quién está activo, con qué teléfono y con qué licencia'}
          </span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        {ops === null ? (
          <div className="p-8 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar el listado de operadores.</div>
        ) : (
          <>
            <section className="p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                La plantilla
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <KpiTile icono={<Users width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                  etiqueta="Operadores activos" valor={activos} formato="entero" />
                {veDinero && (
                  <>
                    <KpiTile icono={<Wallet width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                      etiqueta="Anticipo entregado" valor={anticipoTotal} formato="mxn" />
                    <KpiTile icono={<CheckCheck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                      etiqueta="Comprobado contra ese anticipo" valor={comprobadoTotal} formato="mxn" />
                    <KpiTile icono={<CheckCheck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                      etiqueta="% comprobado de la flota" valor={pctGlobal ?? 0} formato="porcentaje"
                      vacio={pctGlobal === null ? 'Todavía no se ha entregado ningún anticipo' : undefined} />
                  </>
                )}
              </div>
            </section>

            <div className="pt-5 pb-2 px-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                Operador por operador
              </h2>
            </div>
            {ops.length === 0 ? (
              <div className="px-5 pb-5">
                <EstadoVacio icono={<UserCog width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Aún no hay operadores dados de alta en esta flota.
                  {puedeAlta && ' Se registran aquí abajo, con su número de WhatsApp.'}
                </EstadoVacio>
              </div>
            ) : (
              <div className="overflow-x-auto mt-1 pb-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-5 py-2.5 font-medium">Operador</th>
                      <th className="px-5 py-2.5 font-medium">Teléfono</th>
                      <th className="px-5 py-2.5 font-medium">Licencia</th>
                      <th className="px-5 py-2.5 font-medium text-right">Viajes</th>
                      {veDinero && <th className="px-5 py-2.5 font-medium text-right">Anticipo</th>}
                      {veDinero && <th className="px-5 py-2.5 font-medium text-right">Comprobado</th>}
                      {veDinero && <th className="px-5 py-2.5 font-medium text-right">% comprobado</th>}
                      <th className="px-5 py-2.5 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ops.map((o) => (
                      <tr key={o.operadorId} className="border-t" style={{ borderColor: 'var(--line)' }}>
                        <td className="px-5 py-3 font-medium">
                          {o.nombre}
                          {o.numeroEmpleado && (
                            <span className="block text-xs font-normal" style={{ color: 'var(--muted)' }}>
                              #{o.numeroEmpleado}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>{o.telefono ?? '—'}</td>
                        <td className="px-5 py-3"><Licencia o={o} hoy={hoy} /></td>
                        <td className="px-5 py-3 text-right tabular">{o.viajes}</td>
                        {veDinero && <td className="px-5 py-3 text-right tabular">{o.anticipoTotal > 0 ? mxn(o.anticipoTotal) : '—'}</td>}
                        {veDinero && <td className="px-5 py-3 text-right tabular">{o.comprobadoTotal > 0 ? mxn(o.comprobadoTotal) : '—'}</td>}
                        {veDinero && <td className="px-5 py-3"><BarraComprobado pct={o.pctComprobado} /></td>}
                        <td className="px-5 py-3">
                          <StatusPill estado={o.activo ? 'ok' : 'neutral'}>{o.activo ? 'Activo' : 'Inactivo'}</StatusPill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {puedeAlta && (
              <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <UserPlus width={15} height={15} strokeWidth={1.75} />
                  <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                    Registrar un operador
                  </h2>
                </div>
                <FormaConAviso accion={accionAlta} boton="Registrar operador">
                  <Campo nombre="nombre" etiqueta="Nombre" requerido placeholder="Juan Pérez" />
                  <Campo nombre="telefono" etiqueta="WhatsApp" requerido placeholder="999 370 0779"
                    ayuda="10 dígitos con lada. Es por donde manda sus comprobantes." />
                  <Campo nombre="numeroEmpleado" etiqueta="Número de empleado" placeholder="Opcional" />
                  <Campo nombre="licencia" etiqueta="Licencia" placeholder="Opcional" />
                  <Campo nombre="licenciaTipo" etiqueta="Tipo de licencia" placeholder="Federal E, B…" />
                  <Campo nombre="licenciaVence" etiqueta="Vence" tipo="date"
                    ayuda="Sin fecha no se marca a nadie como vencido." />
                </FormaConAviso>
                <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
                  El teléfono se comprueba contra TODAS las flotas, no solo contra la tuya: dos choferes con el mismo
                  número harían que los comprobantes de uno se anoten en los libros del otro. Si ya existe, el alta se
                  rechaza y te dice dónde está.
                </p>
              </section>
            )}

            <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <EstadoVacio>
                El scorecard de conducción (frenado brusco, velocidad, tiempo en ralentí) necesita telemática o GPS
                conectado, y no lo hay — lo mismo para el flujo de coaching que se construiría encima.
              </EstadoVacio>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
