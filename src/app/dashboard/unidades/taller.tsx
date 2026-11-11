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
import { FormaConAviso, CampoTexto, Tarjeta, Disclosure, EstadoVacio, type ResultadoAccion } from '@/app/ui-v2/componentes';
import './unidades.css';
import { getT } from '@/lib/i18n/servidor';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
import { rico } from '@/lib/i18n/rico';

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

const motivoTr = (t: TResto = T_RESTO_ES): Record<PropuestaRutina['motivo'], string> => ({
  vencida_por_dias: t('op.vencida_por_dias'),
  vencida_por_km: t('op.vencida_por_kilometros'),
  sin_historial: t('op.sin_historial_nunca_se_le_ha'),
  sin_odometro: t('op.sin_odometro_declarado_la_rutina_es'),
  odometro_desactualizado: t('op.odometro_desactualizado_el_km_de_la'),
});

function Origen({ o, t = T_RESTO_ES }: { o: OrdenTaller; t?: TResto }) {
  if (o.deAveria) return <span>{t('op.de_averia_autorizada_talacha')}</span>;
  if (o.deRutina) return <span>{t('op.de_rutina', { deRutina: o.deRutina })}</span>;
  return <span>capturada</span>;
}

export async function BloqueTaller({
  sp,
}: {
  sp: { tenant?: string; rol?: string; vista?: string };
}) {
  const { t, idioma } = await getT('resto');
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
    if (!puedeVerRuta(s.rol, RUTA)) return { error: t('op.tu_rol_no_puede_ver_las') };
    if (!puedeAdministrar(s.rol)) return { error: t('op.solo_el_dueno_de_la_flota_2') };
    try {
      const v = validarRutina({
        nombre: String(fd.get('nombre') ?? ''),
        cadaDias: String(fd.get('cadaDias') ?? ''),
        cadaKm: String(fd.get('cadaKm') ?? ''),
      });
      await crearRutina(s.tenantId, v, s.userId);
      revalidatePath(RUTA);
      return { ok: t('op.la_rutina_quedo_declarada_sus_propuestas', { nombre: v.nombre }) };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'declarar la rutina') };
    }
  }

  async function accionAbrirOrden(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAsignar(s.rol)) return { error: t('op.abrir_ordenes_de_taller_es_del') };
    try {
      // A37-S20-01: el patio de la unidad sale de la BASE; fuera del alcance no se abre.
      const alcanceAccion = await alcanceDePatio(s.tenantId, s.userId, s.rol);
      const unidadId = String(fd.get('unidadId') ?? '');
      const actual = await terminalDeRegistro('unidad', s.tenantId, unidadId);
      if (!alcanceAccion || !actual.encontrado || !dentroDelAlcance(alcanceAccion, actual.terminalId)) {
        return { error: t('op.esa_unidad_no_es_de_tu') };
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
    if (!puedeVerRuta(s.rol, RUTA)) return { error: t('op.tu_rol_no_puede_ver_las') };
    if (!puedeAsignar(s.rol)) return { error: t('op.cerrar_ordenes_de_taller_es_del') };
    try {
      // A37-S20-01: la unidad de la orden y su patio salen de la BASE, no del
      // formulario; un POST con la orden de otro patio rebota antes de cerrarla.
      const alcanceAccion = await alcanceDePatio(s.tenantId, s.userId, s.rol);
      if (!alcanceAccion) return { error: t('op.no_pude_comprobar_tu_patio_no') };
      const ordenId = String(fd.get('ordenId') ?? '');
      const unidadId = await unidadDeOrden(s.tenantId, ordenId);
      if (!unidadId) return { error: t('op.esa_orden_no_existe_en_tu') };
      const actual = await terminalDeRegistro('unidad', s.tenantId, unidadId);
      if (!actual.encontrado) return { error: t('op.no_se_encontro_la_unidad_de') };
      exigirDentroDelAlcance(alcanceAccion, actual.terminalId);
      const kmCrudo = String(fd.get('kmServicio') ?? '').trim();
      const km = kmCrudo === '' ? null : Number(kmCrudo);
      if (km !== null && !Number.isFinite(km)) return { error: t('op.el_kilometraje_tiene_que_ser_un') };
      await cerrarOrden(s.tenantId, ordenId, km === null ? null : Math.trunc(km));
      revalidatePath(RUTA);
      return { ok: 'Orden cerrada.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'cerrar la orden') };
    }
  }

  return (
    <section className="rv-un__taller" aria-label={t('op.taller_de_las_unidades')}>
      {/* ── Órdenes abiertas ── */}
      <Tarjeta titulo={t('op.taller_ordenes_abiertas', { length: taller.ordenesAbiertas.length })}>
        {taller.ordenesAbiertas.length === 0 ? (
          <EstadoVacio contenido titulo={t('op.sin_ordenes_abiertas_las_averias_que')} />
        ) : (
          <div className="rv-un__bloque">
            {taller.ordenesAbiertas.map((o) => (
              <Disclosure key={o.id} variante="tarjeta"
                titulo={<>Unidad {o.unidadEco} · {o.tipo} · <Origen t={t} o={o} /></>}
                resumen={fechaHoraMx(o.abiertaEn, idioma)}>
                <div className="rv-un__detalle">
                  {o.descripcion && <span>{o.descripcion}</span>}
                  {opera && dentro(o.unidadId) && (
                    <FormaConAviso accion={accionCerrarOrden} boton={t('op.cerrar_orden')} columnas="md:grid-cols-2">
                      <input type="hidden" name="ordenId" value={o.id} />
                      <CampoTexto name="kmServicio" tipo="number" etiqueta={t('op.km_al_momento_del_servicio')}
                        ayuda={t('op.dejalo_vacio_si_no_se_sabe')} />
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
          <EstadoVacio contenido titulo={t('op.sin_rutinas_declaradas_declara_abajo_la')} />
        ) : taller.propuestas.length === 0 ? (
          <EstadoVacio contenido titulo={t('op.ninguna_rutina_vencida_en_las_unidades')} />
        ) : (
          <div className="rv-un__bloque">
            {taller.propuestas.map((p) => (
              <div key={`${p.rutinaId}|${p.unidadId}`} className="rv-un__item">
                <div className="rv-un__item-cab">{rico(t('op.strong_unidad_strong_e1_e1', { unidadEco: p.unidadEco, rutinaNombre: p.rutinaNombre }), { strong: (c) => <strong>{c}</strong>, e1: (c) => <span>{c}</span> })}<span className="rv-un__apagado">
                    {motivoTr(t)[p.motivo]}
                    {p.diasDesdeServicio !== null && t('op.dias_del_ultimo_servicio', { diasDesdeServicio: p.diasDesdeServicio })}
                    {p.kmDesdeServicio !== null && ` · ${numero(p.kmDesdeServicio, idioma)} km recorridos`}
                  </span>
                  {opera && p.motivo === 'sin_odometro' && (
                    <span className="rv-un__fin">{t('op.captura_el_km_de_la_unidad')}</span>
                  )}
                </div>
                {/* Los motivos de dato faltante piden capturar el dato, no abrir una orden que nadie sabe si toca. */}
                {opera && dentro(p.unidadId) && p.motivo !== 'sin_odometro' && p.motivo !== 'odometro_desactualizado' && (
                  <FormaConAviso accion={accionAbrirOrden} boton={t('op.abrir_orden')} columnas="md:grid-cols-1">
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
        <Disclosure variante="tarjeta" titulo={t('op.declarar_una_rutina_de_mantenimiento')}>
          <FormaConAviso accion={accionCrearRutina} boton={t('op.declarar_rutina')}>
            <CampoTexto name="nombre" etiqueta={t('llaves.nombre')} placeholder={t('op.servicio_de_motor')} obligatorio />
            <CampoTexto name="cadaDias" tipo="number" etiqueta={t('op.cada_cuantos_dias')} ayuda={t('op.vacio_si_la_rutina_no_corre')} />
            <CampoTexto name="cadaKm" tipo="number" etiqueta={t('op.cada_cuantos_km')} ayuda={t('op.vacio_si_no_corre_por_km')} />
          </FormaConAviso>
        </Disclosure>
      )}
    </section>
  );
}
