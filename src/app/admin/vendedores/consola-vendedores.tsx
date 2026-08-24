import { appUrl } from '@/lib/env';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import {
  Activity, BadgePercent, Bot, Building2, CalendarDays, CheckCircle2, Inbox,
  Search, Users,
} from 'lucide-react';
import { getSessionTenant } from '@/lib/auth/session';
import {
  ESTADOS_PROSPECTO, ESTADOS_VIVOS, TRANSICIONES_PROSPECTO,
  conteosVacios, filtrarProspectosTexto, reglaComision,
  validarProspecto, crearProspecto, listarProspectos, listarVendedores,
  asignarProspecto, cambiarEstadoProspecto, actualizarNotasProspecto,
  invitarVendedor, asignarPendientes,
  type ProspectoRow, type VendedorRow,
} from '@/lib/likida/vendedores';
import { ultimasCorridasNegocio, duracionLegible, type CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import { redactarCorreoFrio } from '@/lib/likida/agentes/redactor';
import { descifrarErrorProvision } from '@/lib/auth/invitar';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { saludo, ahoraMs } from '@/lib/saludo';
import { fechaMx, fechaHoraMx, hoyMx } from '@/lib/formato';
import { resolverFormato } from '../ui/formato-preset';
import { StatCard, StatusPill, EstadoVacio, type Estado } from '../ui/kit';
import { BarraPagina, ChipFecha, HeroSaludo, TituloSeccion } from '../../dashboard/resumen-visual';
import { TableroProspectos, type ColumnaTablero, type ResultadoAccion } from './tablero';
import { FormaProspecto, FormaInvitarVendedor, BotonRepartir, type ResultadoForma } from './formas';

const RUTA = '/admin/vendedores';

/** Tarjetas que se pintan por columna. El censo trae ~800 empresas: pintar
 *  cientos de tarjetas por columna cuelga el tablero, así que se recorta y
 *  el recorte SE DICE ("y N más — filtra para verlos"). */
const TOPE_COLUMNA = 30;

/** Resiliencia por sección, mismo helper que los dashboards: una consulta
 *  caída deja `null` y su tarjeta lo dice — jamás un cero con cara de dato. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * El envoltorio de TODA escritura de esta consola: re-gatea superadmin (una
 * server action es un endpoint POST alcanzable sin pasar por el render) y
 * traduce el error para pantalla. Vive a nivel de módulo a propósito: las
 * actions inline lo referencian sin meterlo a sus capturas serializadas.
 */
async function ejecutarComoSuperadmin(
  hacer: () => Promise<void>,
  operacion: string,
): Promise<ResultadoAccion> {
  const s = await getSessionTenant();
  if (s?.rol !== 'superadmin') return { ok: false, error: 'Solo el superadmin administra la zona de vendedores.' };
  try {
    await hacer();
    revalidatePath(RUTA);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mensajeParaPantalla(e, operacion) };
  }
}

/**
 * LA CONSOLA DEL EQUIPO DE VENTAS — el contenido completo de
 * /admin/vendedores, SIN el gate. Vive en su propio archivo, exportado, por
 * la misma razón #2 que `dashboard/inicio-contenido.tsx` documenta: la
 * página llama `requireSuperadmin()` y un preview headless sin sesión no
 * puede montarla — este componente sí se monta con un `nombre` y `sp`
 * arbitrarios, y es el REAL (una copia verificaría la copia).
 *
 * La AUTORIZACIÓN no se relaja con la extracción: el gate de pantalla sigue
 * en admin/layout.tsx + page.tsx, y cada server action de aquí re-gatea
 * superadmin por sesión (`ejecutarComoSuperadmin`) — montar el componente no
 * regala ninguna escritura.
 */
export async function ConsolaVendedores({
  nombre, sp,
}: {
  nombre: string | null;
  sp: { vendedor?: string; q?: string };
}) {
  const [vendedores, prospectos, corridas] = await Promise.all([
    safe<VendedorRow[]>(() => listarVendedores()),
    safe<ProspectoRow[]>(() => listarProspectos()),
    safe<CorridaRegistrada[]>(() => ultimasCorridasNegocio('ventas', 5)),
  ]);

  // ── Server actions — cada una re-gatea superadmin vía el envoltorio ──────

  async function accionMover(id: string, a: string): Promise<ResultadoAccion> {
    'use server';
    return ejecutarComoSuperadmin(() => cambiarEstadoProspecto(String(id), String(a)), 'mover el prospecto');
  }

  async function accionAsignar(id: string, vendedorId: string): Promise<ResultadoAccion> {
    'use server';
    return ejecutarComoSuperadmin(
      () => asignarProspecto(String(id), vendedorId === '' ? null : String(vendedorId)),
      'asignar el prospecto',
    );
  }

  async function accionNota(id: string, nota: string): Promise<ResultadoAccion> {
    'use server';
    return ejecutarComoSuperadmin(() => actualizarNotasProspecto(String(id), String(nota)), 'guardar la nota');
  }

  // El Redactor (C5, Fase 2) devuelve mensaje al ok — no cabe en el
  // envoltorio (que solo sabe {ok:true} pelón), así que re-gatea igual pero
  // arma su propia respuesta con el asunto y el aviso del agente.
  async function accionRedactar(id: string): Promise<ResultadoAccion> {
    'use server';
    const s = await getSessionTenant();
    if (s?.rol !== 'superadmin') return { ok: false, error: 'Solo el superadmin administra la zona de vendedores.' };
    try {
      const r = await redactarCorreoFrio(String(id), s.nombre ?? 'Javier', 'manual', {
        tenantId: s.tenantId,
      });
      revalidatePath(RUTA);
      return {
        ok: true,
        mensaje: `«${r.asunto}» quedó en la cola — apruébala en Aprobaciones.${r.aviso ? ` OJO: ${r.aviso}` : ''}`,
      };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'redactar el correo') };
    }
  }

  async function accionCrearProspecto(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await getSessionTenant();
    if (s?.rol !== 'superadmin') return { ok: false, error: 'Solo el superadmin da de alta prospectos.' };
    try {
      const v = validarProspecto({
        empresa: String(fd.get('empresa') ?? ''),
        contactoNombre: String(fd.get('contacto') ?? ''),
        telefono: String(fd.get('telefono') ?? ''),
        correo: String(fd.get('correo') ?? ''),
        ciudad: String(fd.get('ciudad') ?? ''),
        vacante: String(fd.get('vacante') ?? ''),
        notas: String(fd.get('notas') ?? ''),
        vendedorId: String(fd.get('vendedor') ?? ''),
      });
      await crearProspecto(v, 'manual');
      revalidatePath(RUTA);
      return { ok: true, mensaje: `${v.empresa} entró al tablero${v.vendedorId ? '' : ' sin vendedor — lo puede tomar el asignador'}.` };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'dar de alta el prospecto') };
    }
  }

  async function accionInvitar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await getSessionTenant();
    if (s?.rol !== 'superadmin') return { ok: false, error: 'Solo el superadmin invita vendedores.' };
    try {
      const { email } = await invitarVendedor(String(fd.get('email') ?? ''), String(fd.get('nombre') ?? ''));
      revalidatePath(RUTA);
      // La verdad del flujo, igual que en /dashboard/usuarios: no se emite
      // correo de invitación todavía — prometer "le llegó" sería mentira.
      const liga = appUrl();
      return {
        ok: true,
        mensaje: `${email} ya puede entrar con su correo (enlace mágico) y aterriza en /vendedor. ` +
          `No le llega invitación por correo todavía — pásale tú la liga: ${liga}/login`,
      };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(descifrarErrorProvision(e) ?? e, 'invitar al vendedor') };
    }
  }

  // Sin parámetros a propósito: el botón no captura nada — una función de
  // menos parámetros es asignable a `AccionForma` y eslint no carga argumentos
  // muertos.
  async function accionRepartir(): Promise<ResultadoForma> {
    'use server';
    const s = await getSessionTenant();
    if (s?.rol !== 'superadmin') return { ok: false, error: 'Solo el superadmin corre el asignador.' };
    try {
      const r = await asignarPendientes();
      revalidatePath(RUTA);
      if (r.apagado) {
        // La palanca (0110) con sus palabras: "no había pendientes" mentiría.
        return { ok: false, error: 'El asignador (agente:ventas) está apagado desde Observabilidad. Enciéndelo para repartir.' };
      }
      if (r.sinVendedores) {
        return { ok: false, error: 'No hay vendedores a quienes repartir. Invita al primero aquí abajo y vuelve a correr.' };
      }
      if (r.pendientes === 0) return { ok: true, mensaje: 'No había prospectos pendientes (sin vendedor y en Nuevo) que repartir.' };
      if (r.repartidos === 0) {
        return { ok: false, error: 'No se pudo repartir ninguno — revisa la bitácora del asignador aquí abajo.' };
      }
      const detalle = r.porVendedor.map((v) => `${v.nombre} (${v.n})`).join(', ');
      return { ok: true, mensaje: `Repartió ${r.repartidos} de ${r.pendientes}: ${detalle}. La corrida quedó en la bitácora.` };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'repartir los pendientes') };
    }
  }

  // ── Datos derivados (solo si las lecturas llegaron) ──────────────────────

  const nombresVendedor = new Map((vendedores ?? []).map((v) => [v.id, v.nombre ?? v.email]));
  const opcionesVendedor = (vendedores ?? []).map((v) => ({ id: v.id, nombre: v.nombre ?? v.email }));

  const hayFiltro = Boolean(sp.vendedor || sp.q);
  let columnas: ColumnaTablero[] | null = null;
  const totales = conteosVacios();
  let vivosSinVendedor = 0;
  if (prospectos !== null) {
    for (const p of prospectos) totales[p.estado]++;
    vivosSinVendedor = prospectos.filter((p) => p.vendedorId === null && (ESTADOS_VIVOS as readonly string[]).includes(p.estado)).length;

    const porTexto = filtrarProspectosTexto(prospectos, sp.q);
    const filtrados = sp.vendedor === 'sin'
      ? porTexto.filter((p) => p.vendedorId === null)
      : sp.vendedor
        ? porTexto.filter((p) => p.vendedorId === sp.vendedor)
        : porTexto;

    columnas = ESTADOS_PROSPECTO.map((e) => {
      const en = filtrados.filter((p) => p.estado === e.valor);
      return {
        estado: e.valor,
        rotulo: e.rotulo,
        total: en.length,
        tarjetas: en.slice(0, TOPE_COLUMNA).map((p) => ({
          id: p.id,
          empresa: p.empresa,
          vacante: p.vacante,
          ciudad: p.ciudad,
          notas: p.notas,
          estado: p.estado,
          vendedorId: p.vendedorId,
          vendedorNombre: p.vendedorId ? nombresVendedor.get(p.vendedorId) ?? null : null,
        })),
      };
    });
  }

  const vivos = ESTADOS_VIVOS.reduce((s, e) => s + totales[e], 0);
  const totalProspectos = (Object.values(totales) as number[]).reduce((s, n) => s + n, 0);
  const comision = reglaComision();
  const pct = resolverFormato('porcentaje');
  const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;
  const PILL_CORRIDA: Record<string, Estado> = { ok: 'ok', parcial: 'warn', fallo: 'bad' };

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina icono={<Users {...ICONO} style={{ color: 'var(--muted)' }} />} titulo="Zona de vendedores" />
        <HeroSaludo
          saludo={saludo()} nombre={nombre ?? 'Javier'}
          tagline="El censo convertido en pipeline: prospectos, vendedores y la regla de comisión"
          derecha={
            <div className="shrink-0 pt-1">
              <ChipFecha icono={<CalendarDays {...ICONO} style={{ color: 'var(--muted)' }} />}>
                {fechaMx(hoyMx(new Date(ahoraMs())))}
              </ChipFecha>
            </div>
          }
        />

        <div className="px-5 pb-5 flex-1 space-y-2">
          {/* ── KPIs — solo si el pipeline se pudo LEER: unos ceros sobre una
              base caída afirmarían "no hay prospectos" estando ciegos. */}
          {prospectos === null ? (
            <div className="card p-4 mt-2">
              <p className="text-sm m-0">No se pudo leer el pipeline en este momento. Recarga la página —
                esto NO significa que no haya prospectos: significa que no se pudo leer.</p>
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
              <StatCard icono={<Building2 {...ICONO} />} etiqueta="Prospectos en el pipeline" valor={totalProspectos} formato="entero" />
              <StatCard icono={<Activity {...ICONO} />} etiqueta="Vivos (Nuevo a Negociación)" valor={vivos} formato="entero" />
              <StatCard icono={<CheckCircle2 {...ICONO} />} etiqueta="Cerrados" valor={totales.cerrado} formato="entero" />
              <StatCard icono={<Inbox {...ICONO} />} etiqueta="Vivos sin vendedor" valor={vivosSinVendedor} formato="entero" />
              {vendedores !== null
                ? <StatCard icono={<Users {...ICONO} />} etiqueta="Vendedores con cuenta" valor={vendedores.length} formato="entero" />
                : (
                  <div className="card p-3 h-full flex items-center text-sm" style={{ color: 'var(--muted)' }}>
                    No se pudo leer el equipo de vendedores.
                  </div>
                )}
            </div>
          )}

          {/* ── El agente asignador + el esquema de comisión ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <div className="card p-3">
              <TituloSeccion>Agente asignador</TituloSeccion>
              <p className="text-[13px] mt-2 mb-2" style={{ color: 'var(--muted)' }}>
                Reparte los prospectos sin vendedor (en Nuevo) entre el equipo, equilibrando por carga
                viva. Cada corrida queda en la bitácora de agentes.
              </p>
              <BotonRepartir accion={accionRepartir} />
              <div className="mt-3">
                <TituloSeccion>Últimas corridas</TituloSeccion>
                {corridas === null ? (
                  <p className="text-[12px] mt-1.5 m-0" style={{ color: 'var(--muted)' }}>No se pudo leer la bitácora del asignador.</p>
                ) : corridas.length === 0 ? (
                  <p className="text-[12px] mt-1.5 m-0" style={{ color: 'var(--muted)' }}>El asignador aún no corre. Su primera corrida aparece aquí.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1 list-none p-0 m-0">
                    {corridas.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 text-[12px]">
                        <StatusPill estado={PILL_CORRIDA[c.estado] ?? 'neutral'}>{c.estado}</StatusPill>
                        <span style={{ color: 'var(--muted)' }}>{fechaHoraMx(c.inicio)}</span>
                        <span className="tabular">
                          {c.tareasHechas !== null && c.tareasTotal !== null ? `${c.tareasHechas}/${c.tareasTotal}` : '—'}
                        </span>
                        <span style={{ color: 'var(--faint)' }}>{duracionLegible(c.duracionMs) ?? ''}</span>
                        {c.error && <span className="truncate" style={{ color: 'var(--bad)' }}>{c.error}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {/* Lo que NO existe no se pinta como si existiera: los agentes
                  que buscan leads y hacen el primer acercamiento son roadmap
                  — el WhatsApp de Likida sigue en número de prueba y el
                  buscador necesita fuentes externas. Texto, no tarjeta viva. */}
              <p className="text-[11px] mt-3 m-0" style={{ color: 'var(--faint)' }}>
                Siguiente paso del roadmap: agentes que busquen leads nuevos y hagan el primer
                acercamiento. No existen todavía y esta pantalla no los va a fingir.
              </p>
            </div>

            <div className="card p-3">
              <TituloSeccion>Esquema de comisión</TituloSeccion>
              <div className="mt-2 flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
                  <BadgePercent width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
                </div>
                <div className="text-[13px] space-y-1">
                  <p className="m-0 font-medium">{comision.primerMes}</p>
                  <p className="m-0 font-medium">{comision.recurrente}</p>
                  <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>{comision.aclaracion}</p>
                </div>
              </div>
            </div>
          </div>

          {/* ── El tablero ── */}
          {columnas !== null && (
            <div className="card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TituloSeccion>Pipeline de prospectos</TituloSeccion>
                {/* Filtro por GET: los searchParams SON el estado del filtro,
                    así que el link se comparte y el refresh no lo pierde. */}
                <form method="get" className="flex flex-wrap items-center gap-1.5">
                  <select name="vendedor" defaultValue={sp.vendedor ?? ''} aria-label="Filtrar por vendedor"
                    className="hairline rounded-lg px-2 h-8 text-[12px] outline-none" style={{ background: 'var(--surface)' }}>
                    <option value="">Todos los vendedores</option>
                    <option value="sin">Sin asignar</option>
                    {opcionesVendedor.map((v) => (
                      <option key={v.id} value={v.id}>{v.nombre}</option>
                    ))}
                  </select>
                  <input name="q" defaultValue={sp.q ?? ''} placeholder="Empresa, vacante o ciudad" maxLength={120}
                    className="hairline rounded-lg px-2.5 h-8 text-[12px] outline-none w-52" style={{ background: 'var(--surface)' }} />
                  <button type="submit"
                    className="h-8 px-3 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85"
                    style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
                    <Search width={13} height={13} strokeWidth={2} /> Filtrar
                  </button>
                  {hayFiltro && (
                    <Link href={RUTA} className="text-[12px] font-medium px-2" style={{ color: 'var(--muted)' }}>
                      Quitar filtros
                    </Link>
                  )}
                </form>
              </div>
              <div className="mt-2.5">
                {totalProspectos === 0 ? (
                  <EstadoVacio icono={<Building2 width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                    Todavía no hay prospectos. Agrega el primero aquí abajo — o importa el censo, que es
                    para lo que existe esta zona.
                  </EstadoVacio>
                ) : (
                  <TableroProspectos
                    columnas={columnas}
                    orden={ESTADOS_PROSPECTO.map((e) => e.valor)}
                    transiciones={TRANSICIONES_PROSPECTO}
                    rotulos={Object.fromEntries(ESTADOS_PROSPECTO.map((e) => [e.valor, e.rotulo]))}
                    vendedores={opcionesVendedor}
                    mover={accionMover}
                    asignar={accionAsignar}
                    guardarNota={accionNota}
                    redactar={accionRedactar}
                    hayFiltro={hayFiltro}
                  />
                )}
              </div>
            </div>
          )}

          {/* ── Desempeño por vendedor — cifras REALES de la tabla prospecto. */}
          <div className="card p-3">
            <TituloSeccion>Desempeño por vendedor</TituloSeccion>
            {vendedores === null ? (
              <p className="text-sm mt-2 m-0" style={{ color: 'var(--muted)' }}>No se pudo leer el equipo en este momento.</p>
            ) : vendedores.length === 0 ? (
              <div className="mt-2">
                <EstadoVacio icono={<Users width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Todavía no hay vendedores. Invita al primero aquí abajo: entra con su correo y ve solo
                  sus prospectos en /vendedor.
                </EstadoVacio>
              </div>
            ) : (
              <div className="overflow-x-auto mt-2">
                <table className="w-full border-collapse">
                  <thead>
                    <tr style={{ background: 'var(--canvas)' }}>
                      {['Vendedor', 'Asignados', ...ESTADOS_PROSPECTO.map((e) => e.rotulo), 'Conversión'].map((h, i, todos) => (
                        <th key={h} className={`etiqueta-mono text-[10px] font-medium uppercase px-3 py-1.5 ${i === 0 ? 'text-left rounded-l-lg' : 'text-right'} ${i === todos.length - 1 ? 'rounded-r-lg' : ''}`}
                          style={{ color: 'var(--muted)' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {vendedores.map((v) => (
                      <tr key={v.id} className="border-b" style={{ borderColor: 'var(--line2)' }}>
                        <td className="px-3 py-2 text-sm font-medium whitespace-nowrap">{v.nombre ?? v.email}</td>
                        <td className="px-3 py-2 text-[13px] text-right tabular">{v.asignados}</td>
                        {ESTADOS_PROSPECTO.map((e) => (
                          <td key={e.valor} className="px-3 py-2 text-[13px] text-right tabular">{v.conteos[e.valor]}</td>
                        ))}
                        <td className="px-3 py-2 text-[13px] text-right whitespace-nowrap">
                          {/* Sin cartera no hay tasa: un "0%" pintado se
                              leería como "lo intentó y no cerró". */}
                          {v.tasaConversion === null
                            ? <span style={{ color: 'var(--faint)' }}>sin actividad todavía</span>
                            : <span className="tabular">{pct(v.tasaConversion * 100)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Altas ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <div className="card p-3">
              <TituloSeccion>Agregar prospecto</TituloSeccion>
              <div className="mt-2">
                <FormaProspecto accion={accionCrearProspecto} vendedores={opcionesVendedor} />
              </div>
            </div>
            <div className="card p-3">
              <TituloSeccion>Invitar vendedor</TituloSeccion>
              <p className="text-[12px] mt-2 mb-2 m-0" style={{ color: 'var(--muted)' }}>
                Cuenta de Likida (sin flota): entra a /vendedor y ve únicamente sus prospectos.
              </p>
              <FormaInvitarVendedor accion={accionInvitar} />
            </div>
          </div>

          <p className="text-[11px] pt-1 m-0 flex items-center gap-1.5" style={{ color: 'var(--faint)' }}>
            <Bot width={12} height={12} strokeWidth={1.75} />
            La comisión está documentada como regla de negocio en la base (migración 0105) y en esta
            pantalla; el pago se calcula sobre cobros reales cuando existan.
          </p>
        </div>
      </div>
    </main>
  );
}
