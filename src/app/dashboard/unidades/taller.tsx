import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAsignar, puedeAdministrar } from '@/lib/auth/permisos';
import { alcanceDePatio, dentroDelAlcance, exigirDentroDelAlcance } from '@/lib/auth/patio';
import { terminalDeRegistro, terminalesDeRegistros } from '@/lib/likida/terminales';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import {
  getTaller, validarRutina, crearRutina, abrirOrdenProgramada, cerrarOrden, unidadDeOrden, OrdenYaAbierta,
  type OrdenTaller, type PropuestaRutina,
} from '@/lib/likida/mantenimiento';
import { fechaHoraMx, numero } from '@/lib/formato';
import { FormaConAviso, CampoTexto, Tarjeta, Disclosure, type ResultadoAccion } from '@/app/ui-v2/componentes';
import './unidades.css';

/**
 * EL TALLER (Fase 9, 0209) — la sección de mantenimiento del registro de
 * unidades. Enseña lo que la tabla `mantenimiento` por fin registra:
 *
 *  · Órdenes abiertas, con su origen dicho (avería firmada de talacha, rutina
 *    preventiva, o captura) — cerrarlas pide el km del servicio si se sabe,
 *    y un km que no se sabe se queda null, jamás 0.
 *  · Rutinas preventivas por días y/o km ("lo que ocurra primero") y sus
 *    PROPUESTAS: la vencida se enseña con su motivo — incluido "sin odómetro
 *    declarado", que es una falta de dato, no un "al día". La orden la abre
 *    un humano con el botón; aquí no hay cron que gaste solo.
 *
 * Puertas: VER es área operacion (la misma de la página); abrir/cerrar
 * órdenes es `puedeAsignar` (el encargado opera el taller); declarar rutinas
 * es `puedeAdministrar` (una rutina es política de la flota, como la unidad
 * misma). Las tres se RE-COMPRUEBAN dentro de cada action.
 */

const RUTA = '/dashboard/unidades';

const MOTIVO: Record<PropuestaRutina['motivo'], string> = {
  vencida_por_dias: 'vencida por días',
  vencida_por_km: 'vencida por kilómetros',
  sin_historial: 'sin historial — nunca se le ha hecho; propuesta de arranque',
  sin_odometro: 'sin odómetro declarado — la rutina es por km y la unidad no tiene km capturado: no se puede evaluar',
  odometro_desactualizado: 'odómetro desactualizado — el km de la unidad quedó atrás del km del último servicio: captura el km actual en la unidad para poder leer el reloj',
};

function Origen({ o }: { o: OrdenTaller }) {
  if (o.deAveria) return <span>de avería autorizada (talacha)</span>;
  if (o.deRutina) return <span>de rutina «{o.deRutina}»</span>;
  return <span>capturada</span>;
}

export async function BloqueTaller({
  sp,
}: {
  sp: { tenant?: string; rol?: string; vista?: string };
}) {
  const { tenantId, rol, userId } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) return null;

  // SIN catch (el criterio de la página): una sección que existe para avisar
  // de mantenimiento vencido no puede pintar "todo al día" porque la lectura
  // falló — se cae y error.tsx lo dice.
  const taller = await getTaller(tenantId);
  const opera = puedeAsignar(rol);
  const administra = puedeAdministrar(rol);

  // A37-S20-01: el patio del jefe de tráfico acota el taller igual que las
  // unidades. Si no se pudo leer el alcance o el patio de las unidades, no se
  // ofrece nada que escriba (el servidor lo vuelve a comprobar en cada action).
  const alcance = opera ? await alcanceDePatio(tenantId, userId, rol) : null;
  let patioPorUnidad: Map<string, string | null> | null = null;
  if (alcance && alcance.tipo === 'patio') {
    try {
      patioPorUnidad = await terminalesDeRegistros('unidad', tenantId, [
        ...taller.ordenesAbiertas.map((o) => o.unidadId), ...taller.propuestas.map((p) => p.unidadId),
      ]);
    } catch { /* sin patio legible no se ofrece escribir */ }
  }
  const dentro = (unidadId: string): boolean =>
    alcance?.tipo === 'flota' || (patioPorUnidad !== null && dentroDelAlcance(alcance, patioPorUnidad.get(unidadId) ?? null));

  async function accionCrearRutina(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: 'Tu rol no puede ver las unidades.' };
    if (!puedeAdministrar(s.rol)) return { error: 'Solo el dueño de la flota declara rutinas de mantenimiento.' };
    try {
      const v = validarRutina({
        nombre: String(fd.get('nombre') ?? ''),
        cadaDias: String(fd.get('cadaDias') ?? ''),
        cadaKm: String(fd.get('cadaKm') ?? ''),
      });
      await crearRutina(s.tenantId, v, s.userId);
      revalidatePath(RUTA);
      return { ok: `La rutina «${v.nombre}» quedó declarada. Sus propuestas salen aquí en cuanto venza en alguna unidad.` };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'declarar la rutina') };
    }
  }

  async function accionAbrirOrden(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAsignar(s.rol)) return { error: 'Abrir órdenes de taller es del encargado o del dueño.' };
    try {
      // A37-S20-01: el patio de la unidad sale de la BASE; fuera del alcance no se abre.
      const alcanceAccion = await alcanceDePatio(s.tenantId, s.userId, s.rol);
      const unidadId = String(fd.get('unidadId') ?? '');
      const actual = await terminalDeRegistro('unidad', s.tenantId, unidadId);
      if (!alcanceAccion || !actual.encontrado || !dentroDelAlcance(alcanceAccion, actual.terminalId)) {
        return { error: 'Esa unidad no es de tu patio.' };
      }
      await abrirOrdenProgramada(s.tenantId, String(fd.get('rutinaId') ?? ''), unidadId);
    } catch (e) {
      // A37-S20-04: SOLO el choque de la unique de la 0209 es benigno (el doble clic que
      // pierde la carrera ve la orden ya abierta al revalidar). Todo lo demás se DICE.
      if (e instanceof OrdenYaAbierta) {
        revalidatePath(RUTA);
        return { ok: 'Esa orden ya estaba abierta.' };
      }
      return { error: mensajeParaPantalla(e, 'abrir la orden') };
    }
    revalidatePath(RUTA);
    return { ok: 'Orden abierta.' };
  }

  async function accionCerrarOrden(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: 'Tu rol no puede ver las unidades.' };
    if (!puedeAsignar(s.rol)) return { error: 'Cerrar órdenes de taller es del encargado o del dueño.' };
    try {
      // A37-S20-01: la unidad de la orden y su patio salen de la BASE, no del
      // formulario; un POST con la orden de otro patio rebota antes de cerrarla.
      const alcanceAccion = await alcanceDePatio(s.tenantId, s.userId, s.rol);
      if (!alcanceAccion) return { error: 'No pude comprobar tu patio — no se cerró nada. Vuelve a intentar.' };
      const ordenId = String(fd.get('ordenId') ?? '');
      const unidadId = await unidadDeOrden(s.tenantId, ordenId);
      if (!unidadId) return { error: 'Esa orden no existe en tu flota. Recarga la pantalla.' };
      const actual = await terminalDeRegistro('unidad', s.tenantId, unidadId);
      if (!actual.encontrado) return { error: 'No se encontró la unidad de esa orden en tu flota. Recarga la pantalla.' };
      exigirDentroDelAlcance(alcanceAccion, actual.terminalId);
      const kmCrudo = String(fd.get('kmServicio') ?? '').trim();
      const km = kmCrudo === '' ? null : Number(kmCrudo);
      if (km !== null && !Number.isFinite(km)) return { error: 'El kilometraje tiene que ser un número (o déjalo vacío si no se sabe).' };
      await cerrarOrden(s.tenantId, ordenId, km === null ? null : Math.trunc(km));
      revalidatePath(RUTA);
      return { ok: 'Orden cerrada.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'cerrar la orden') };
    }
  }

  return (
    <section className="rv-un__taller" aria-label="Taller de las unidades">
      {/* ── Órdenes abiertas ── */}
      <Tarjeta titulo={`Taller: órdenes abiertas (${taller.ordenesAbiertas.length})`}>
        {taller.ordenesAbiertas.length === 0 ? (
          <p className="rv-un__nota">
            {/* c3-5: la promesa completa. Los viajes dados de alta por WhatsApp no
                traen unidad asignada (0047) y su avería NO puede abrir orden — para
                una flota 100 % WhatsApp el texto anterior era mentira permanente. */}
            Sin órdenes abiertas. Las averías que tu jefe de patio autoriza por WhatsApp abren la suya solas
            cuando el viaje tiene unidad asignada; sin unidad, la orden se abre aquí a mano.
          </p>
        ) : (
          <div className="rv-un__bloque">
            {taller.ordenesAbiertas.map((o) => (
              <Disclosure key={o.id} variante="tarjeta"
                titulo={<>Unidad {o.unidadEco} · {o.tipo} · <Origen o={o} /></>}
                resumen={fechaHoraMx(o.abiertaEn)}>
                <div className="rv-un__detalle">
                  {o.descripcion && <span>{o.descripcion}</span>}
                  {opera && dentro(o.unidadId) && (
                    <FormaConAviso accion={accionCerrarOrden} boton="Cerrar orden" columnas="md:grid-cols-2">
                      <input type="hidden" name="ordenId" value={o.id} />
                      <CampoTexto name="kmServicio" tipo="number" etiqueta="Km al momento del servicio"
                        ayuda="Déjalo vacío si no se sabe: un km que no se midió no se inventa. Alimenta el reloj de las rutinas por km." />
                    </FormaConAviso>
                  )}
                </div>
              </Disclosure>
            ))}
          </div>
        )}
      </Tarjeta>

      {/* ── Propuestas de las rutinas ── */}
      <Tarjeta titulo={`Rutinas preventivas: propuestas (${taller.propuestas.length})`}>
        {taller.rutinas.length === 0 ? (
          <p className="rv-un__nota">
            Sin rutinas declaradas. Declara abajo la primera (p. ej. «Servicio de motor» cada 10,000 km o 180 días) y Likida
            te propone aquí cuál unidad ya la trae vencida.
          </p>
        ) : taller.propuestas.length === 0 ? (
          <p className="rv-un__nota">
            Ninguna rutina vencida en las unidades activas, con los relojes que se pueden leer (el km solo cuenta si está
            capturado en la unidad y en el servicio anterior).
          </p>
        ) : (
          <div className="rv-un__bloque">
            {taller.propuestas.map((p) => (
              <div key={`${p.rutinaId}|${p.unidadId}`} className="rv-un__item">
                <div className="rv-un__item-cab">
                  <strong>Unidad {p.unidadEco}</strong>
                  <span>«{p.rutinaNombre}»</span>
                  <span className="rv-un__apagado">
                    {MOTIVO[p.motivo]}
                    {p.diasDesdeServicio !== null && ` · ${p.diasDesdeServicio} días del último servicio`}
                    {p.kmDesdeServicio !== null && ` · ${numero(p.kmDesdeServicio)} km recorridos`}
                  </span>
                  {opera && p.motivo === 'sin_odometro' && (
                    <span className="rv-un__fin">captura el km de la unidad para evaluarla</span>
                  )}
                </div>
                {/* Los motivos de dato faltante piden capturar el dato, no abrir una orden que nadie sabe si toca. */}
                {opera && dentro(p.unidadId) && p.motivo !== 'sin_odometro' && p.motivo !== 'odometro_desactualizado' && (
                  <FormaConAviso accion={accionAbrirOrden} boton="Abrir orden" columnas="md:grid-cols-1">
                    <input type="hidden" name="rutinaId" value={p.rutinaId} />
                    <input type="hidden" name="unidadId" value={p.unidadId} />
                  </FormaConAviso>
                )}
              </div>
            ))}
          </div>
        )}
      </Tarjeta>

      {/* ── Declarar rutina ── */}
      {administra && (
        <Disclosure variante="tarjeta" titulo="Declarar una rutina de mantenimiento">
          <FormaConAviso accion={accionCrearRutina} boton="Declarar rutina">
            <CampoTexto name="nombre" etiqueta="Nombre" placeholder="Servicio de motor" obligatorio />
            <CampoTexto name="cadaDias" tipo="number" etiqueta="Cada cuántos días" ayuda="Vacío si la rutina no corre por tiempo." />
            <CampoTexto name="cadaKm" tipo="number" etiqueta="Cada cuántos km" ayuda="Vacío si no corre por km. Con ambos, vence lo que ocurra primero." />
          </FormaConAviso>
        </Disclosure>
      )}
    </section>
  );
}
