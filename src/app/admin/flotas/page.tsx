import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { usd } from '@/lib/utils';
import { Truck, ExternalLink, Plus } from 'lucide-react';
import { requireSuperadmin } from '@/lib/auth/guard';
import { crearFlota, mensajeParaPantalla } from '@/lib/likida/administracion';
import { actualizarFacilidad15 } from '@/lib/likida/repo';
import ContadorRetro from '../contador-retro';
import { HBars } from '../ui/graficas';
import { ChartCard, EstadoVacio } from '../ui/kit';
import { FormaConAviso, Campo, type ResultadoAccion } from '../ui/forma';

export const dynamic = 'force-dynamic';

/**
 * Dar de alta una flota — hasta hoy, un INSERT tecleado a mano.
 *
 * Repite `requireSuperadmin` adentro aunque el layout de /admin ya gatee: un
 * server action es su propio endpoint y no pasa por el layout. Va FUERA del
 * try porque redirige lanzando, y atraparlo convertiría "no eres superadmin"
 * en un aviso rojo dentro de una consola que no debería estar sirviéndose.
 */
async function accionCrearFlota(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  'use server';
  const s = await requireSuperadmin();

  const nombre = String(fd.get('nombre') ?? '').trim();
  const emailAdmin = String(fd.get('emailAdmin') ?? '').trim();
  try {
    const { userId } = await crearFlota(
      {
        nombre,
        rfc: String(fd.get('rfc') ?? ''),
        ciudad: String(fd.get('ciudad') ?? ''),
        emailAdmin,
        nombreAdmin: String(fd.get('nombreAdmin') ?? ''),
        dedicacionExclusivaCarga: fd.get('dedicacionExclusivaCarga') === 'on' ? true : undefined,
        regimenFiscal: String(fd.get('regimenFiscal') ?? '') || undefined,
      },
      { id: s.userId },
    );

    revalidatePath('/admin/flotas');
    return {
      ok: userId
        ? `"${nombre}" dada de alta, con ${emailAdmin} como administrador. Ya puede entrar a su panel.`
        : `"${nombre}" dada de alta. Todavía no tiene a nadie que pueda entrar: falta darle de alta un usuario.`,
    };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'dar de alta la flota') };
  }
}

// AUDITORÍA 14: la declaración del 15% (RFA 2.9) se puede VER y CORREGIR.
async function accionFacilidad(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  'use server';
  await requireSuperadmin();
  const flotaId = String(fd.get('flotaId') ?? '');
  const ded = fd.get('ded') === 'si' ? true : fd.get('ded') === 'no' ? false : undefined;
  const reg = fd.get('reg') === 'si' ? true : fd.get('reg') === 'no' ? false : undefined;
  if (!flotaId) return { error: 'Falta la flota.' };
  try {
    await actualizarFacilidad15(flotaId, ded, reg);
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'guardar la declaración') };
  }
  revalidatePath('/admin/flotas');
  return { ok: ded !== undefined ? 'Declaración del 15% actualizada.' : 'Declaración del 15% borrada (sin declarar).' };
}

/**
 * Flotas / Clientes — versión dedicada y con más aire de la sección
 * "Flotas" de Inicio. Misma tabla real (`resumen.flotas`: nombre, plan,
 * viajes, costoIaUsd) de `getResumenNegocio()`, aquí ordenada por costo de
 * IA de mayor a menor (el único "sort" que aplica sin over-engineering).
 * El contador retro junto al título es el mismo componente Solari que usa
 * Inicio para el MRR, mostrando aquí `resumen.tenants` — el único número
 * de cabecera de esta página con un dato real y singular detrás.
 */
export default async function FlotasPage() {
  const r = await getResumenNegocio();
  const flotasOrdenadas = [...r.flotas].sort((a, b) => b.costoIaUsd - a.costoIaUsd);

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Truck width={16} height={16} strokeWidth={1.75} />
          <span className="text-sm font-medium">Flotas / Clientes</span>
        </div>
        <ContadorRetro valor={r.tenants} digitos={3} etiqueta="Flotas dadas de alta" tamaño="lg" />
      </header>

      <div className="glass-panel overflow-hidden">
        <div className="px-5 pt-5 pb-2 flex items-center justify-between gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Tabla maestra
          </h2>
          {r.flotas.length > 1 && (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              Ordenada por costo de IA, de mayor a menor
            </span>
          )}
        </div>
        {flotasOrdenadas.length === 0 ? (
          <div className="px-5 pt-3 pb-5">
            <EstadoVacio icono={<Truck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              Sin flotas dadas de alta todavía.
            </EstadoVacio>
          </div>
        ) : (
          <div className="overflow-x-auto mt-1">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--muted)' }} className="text-left">
                  <th className="px-5 py-2.5 font-medium">Flota</th>
                  <th className="px-5 py-2.5 font-medium">Plan</th>
                  <th className="px-5 py-2.5 font-medium text-right">Viajes</th>
                  <th className="px-5 py-2.5 font-medium text-right">Costo de IA</th>
                  <th className="px-5 py-2.5 font-medium">Facilidad 15% (RFA 2.9)</th>
                  <th className="px-5 py-2.5 font-medium text-right"></th>
                </tr>
              </thead>
              <tbody>
                {flotasOrdenadas.map((f) => (
                  <tr key={f.id} className="border-t transition-colors hover:bg-[color-mix(in_srgb,var(--muted)_6%,transparent)]" style={{ borderColor: 'var(--line)' }}>
                    <td className="px-5 py-3 font-medium">{f.nombre}</td>
                    <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>{f.plan}</td>
                    <td className="px-5 py-3 text-right tabular">{f.viajes}</td>
                    <td className="px-5 py-3 text-right tabular">{usd(f.costoIaUsd)}</td>
                    <td className="px-5 py-3">
                      <FormaConAviso accion={accionFacilidad} boton="Guardar" columnas="110px auto">
                        <input type="hidden" name="flotaId" value={f.id} />
                        <select name="ded" defaultValue={f.facilidad15?.dedicacionExclusivaCarga === true ? 'si' : f.facilidad15?.dedicacionExclusivaCarga === false ? 'no' : ''}
                          className="text-xs" style={{ width: 110 }}>
                          <option value="">Carga: —</option>
                          <option value="si">Carga: Sí</option>
                          <option value="no">Carga: No</option>
                        </select>
                        <select name="reg" defaultValue={f.facilidad15?.regimenElegible === true ? 'si' : f.facilidad15?.regimenElegible === false ? 'no' : ''}
                          className="text-xs" style={{ width: 110 }}>
                          <option value="">Régimen: —</option>
                          <option value="si">Régimen: Sí</option>
                          <option value="no">Régimen: No</option>
                        </select>
                      </FormaConAviso>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {/* Ve el panel REAL que ve esa flota (mismo /dashboard del
                          cliente), no una copia — "Login as" honesto: sin
                          fingir ser un usuario de esa flota, el superadmin
                          entra con su propia sesión y `?tenant=` resuelve el
                          tenant, validado contra la tabla real (ver
                          dashboard/page.tsx). */}
                      {/* DOS PUERTAS, no una. El dueño y el jefe de tráfico
                          comparten la misma URL y ven cosas distintas
                          (visibilidad.ts): sin el segundo link no había forma
                          de comprobar qué ve cada quien sin la contraseña de
                          los dos. `?rol=` solo QUITA visibilidad y solo se
                          honra si la sesión real es superadmin. */}
                      <div className="inline-flex items-center gap-1.5">
                        <Link href={`/dashboard?tenant=${f.id}`} target="_blank"
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">
                          <ExternalLink width={12} height={12} strokeWidth={1.75} /> Panel de dueño
                        </Link>
                        <Link href={`/dashboard/despacho?tenant=${f.id}&rol=encargado`} target="_blank"
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">
                          <ExternalLink width={12} height={12} strokeWidth={1.75} /> Panel de jefe de flota
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Ranking real de las mismas flotas de la tabla, por costo de IA —
            HBars (design system v2) compara categorías de un vistazo; la
            tabla arriba se queda porque tiene columnas que una barra no
            puede mostrar (plan, viajes, el link "Ver dashboard"). Solo con
            2+ flotas: con 1 sola, "ranking" no dice nada que la tabla ya no
            diga. */}
        {flotasOrdenadas.length > 1 && (
          <div className="px-5 pt-2 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <ChartCard titulo="Top flotas por costo de IA" tamano="M">
              <HBars datos={flotasOrdenadas.map((f) => ({ etiqueta: f.nombre, valor: f.costoIaUsd }))} formato="usd" />
            </ChartCard>
          </div>
        )}

        <section className="px-5 pt-5 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Plus width={15} height={15} strokeWidth={1.75} />
            <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
              Dar de alta una flota
            </h2>
          </div>
          <FormaConAviso accion={accionCrearFlota} boton="Dar de alta">
            <Campo nombre="nombre" etiqueta="Nombre de la flota" requerido placeholder="Flota de ejemplo" />
            <Campo nombre="rfc" etiqueta="RFC" placeholder="Opcional"
              ayuda="Se rechaza si no pasa el dígito verificador." />
            <Campo nombre="ciudad" etiqueta="Ciudad" placeholder="Opcional" />
            <Campo nombre="emailAdmin" etiqueta="Correo del administrador" tipo="email" placeholder="dueño@flota.mx"
              ayuda="Sin él, la flota nace sin quién pueda entrar." />
            <Campo nombre="nombreAdmin" etiqueta="Nombre del administrador" placeholder="Opcional" />
            <label className="flex items-start gap-2 text-xs mt-1" style={{ color: 'var(--muted)' }}>
              <input type="checkbox" name="dedicacionExclusivaCarga" className="mt-0.5" />
              <span>
                <b>¿Exclusivamente autotransporte de carga federal?</b> — habilita la
                facilidad del 15% de diésel en efectivo (RFA 2026 regla 2.9).
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs" style={{ color: 'var(--muted)' }}>
              <span className="mt-1">Régimen fiscal (c_RegimenFiscal SAT):</span>
              <select name="regimenFiscal" className="text-xs" defaultValue="">
                <option value="">Sin declarar</option>
                <option value="601">601 — General de Ley PM (coordinados)</option>
                <option value="612">612 — PF con actividades empresariales</option>
                <option value="605">605 — Sueldos y Salarios</option>
                <option value="606">606 — Arrendamiento</option>
                <option value="607">607 — Régimen de Enajenación</option>
                <option value="608">608 — Demás ingresos</option>
                <option value="610">610 — Residentes en el Extranjero</option>
                <option value="611">611 — Ingresos por Dividendos</option>
                <option value="615">615 — Incorporación Fiscal</option>
                <option value="616">616 — Otros regímenes</option>
              </select>
              <span>
                — la facilidad del 15% (RFA 2.9) exige 601 o 612; cualquier otro
                no califica y el efectivo en combustible no se deduce.
              </span>
            </label>
          </FormaConAviso>
          <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
            El RFC se valida en el alta porque es la única oportunidad barata: con uno inválido, el motor apaga la
            comprobación de a nombre de quién vienen las facturas y ninguna se rechaza por estar a nombre de otro. La
            flota creería que se está revisando.
          </p>
        </section>

        <div className="px-5 pt-4 pb-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio>
            &quot;Ver dashboard&quot; ya existe (arriba) — entra al panel real de esa flota con tu propia sesión de superadmin, sin credenciales nuevas. Uso vs. límite, salud (activa/en riesgo/morosa), MRR por cliente y un audit log de qué flota viste y cuándo siguen en el roadmap.
            <br /><br />
            Retención por cohortes, distribución por plan — necesita más de 1 tenant para decir algo real.
          </EstadoVacio>
        </div>
      </div>
    </div>
  );
}
