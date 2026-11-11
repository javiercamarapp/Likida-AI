import type { Metadata } from 'next';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { listarInterruptores, apagar, encender } from '@/lib/likida/interruptores';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { corridasRecientes, type CorridaCruzada } from '@/lib/admin/corridas-cruzadas';
import { getLatencias, type LatenciasMedidas, type FilaLatencia, type FilaLatenciaIa } from '@/lib/admin/slo';
import { fechaHoraMx, numero } from '@/lib/formato';
import { BotonEnlace, EstadoError, MarcoPagina, StatusChip, Tarjeta, TablaBase, type ColumnaBase, type TonoEstado } from '../../ui-v2/componentes';
import { SeccionInterruptores, type InterruptorParaUi } from './interruptores-ui';
import { etiquetaInterruptor, notaDeLatenciaRuta } from './etiquetas';
import { nombreReloj as nombreRelojTr } from '../crons/estado-relojes';
import { CRONS, type CronId } from '@/lib/admin/salud';
import type { ResultadoAccion } from '../ui/forma';
import '../sistema.css';
import { getT } from '@/lib/i18n/servidor';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import type { Idioma } from '@/lib/i18n/idioma';

export const dynamic = 'force-dynamic';

/** El estado de la corrida como chip; un valor fuera del dominio se pinta crudo en neutro — visible, no roto. */
const chipCorrida = (t: TSistema = T_SISTEMA_ES): Record<string, { tono: TonoEstado; etiqueta: string }> => ({
  ok: { tono: 'ok', etiqueta: 'OK' },
  parcial: { tono: 'warn', etiqueta: t('observabilidad.parcial') },
  fallo: { tono: 'bad', etiqueta: t('observabilidad.fallo') },
});

/** "3 s" / "2.4 min" — para la tabla. `null` (sin fin) se pinta '—'. */
function duracion(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  return `${Math.round(ms / 6_000) / 10} min`;
}

/** Latencia en ms para la tabla de percentiles: «87 ms» por debajo de un segundo, «2.4 s» por encima. */
function msLegible(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return duracion(ms);
}

/** Un reloj se llama como en Relojes; lo que no es un reloj conocido se muestra tal cual (visible, no roto). */
const nombreReloj = (id: string, t: TSistema = T_SISTEMA_ES): string => ((CRONS as readonly string[]).includes(id) ? nombreRelojTr(t)[id as CronId] : id);

function columnasLatencia(etiqueta: string, nombre: (n: string) => string, notas?: (n: string) => string | null, t: TSistema = T_SISTEMA_ES, idioma?: Idioma): ColumnaBase<FilaLatencia>[] {
  return [
    { id: 'nombre', titulo: etiqueta, principal: true, celda: (f) => <>{nombre(f.nombre)}{notas?.(f.nombre) ? <span className="adm-sis-sub">{t('observabilidad.mide', { nota: notas(f.nombre) ?? '' })}</span> : null}</> },
    { id: 'muestras', titulo: t('observabilidad.muestras'), alinear: 'der', celda: (f) => numero(f.muestras, idioma) },
    { id: 'p50', titulo: 'p50', alinear: 'der', celda: (f) => msLegible(f.p50Ms) },
    { id: 'p95', titulo: 'p95', alinear: 'der', celda: (f) => msLegible(f.p95Ms) },
    { id: 'max', titulo: t('observabilidad.max'), alinear: 'der', celda: (f) => msLegible(f.maxMs) },
    { id: 'fallos', titulo: t('observabilidad.fallos'), alinear: 'der', celda: (f) => (f.fallos > 0 ? <StatusChip tono="bad">{numero(f.fallos, idioma)}</StatusChip> : numero(f.fallos, idioma)) },
  ];
}

const columnasIa = (t: TSistema = T_SISTEMA_ES, idioma?: Idioma): ColumnaBase<FilaLatenciaIa>[] => ([
  { id: 'fase', titulo: t('observabilidad.fase'), principal: true, celda: (f) => f.fase },
  { id: 'muestras', titulo: t('observabilidad.medidas'), alinear: 'der', celda: (f) => numero(f.muestras, idioma) },
  { id: 'sin', titulo: t('observabilidad.sin_duracion'), alinear: 'der', celda: (f) => numero(f.sinDuracion, idioma) },
  { id: 'p50', titulo: 'p50', alinear: 'der', celda: (f) => msLegible(f.p50Ms) },
  { id: 'p95', titulo: 'p95', alinear: 'der', celda: (f) => msLegible(f.p95Ms) },
  { id: 'max', titulo: t('observabilidad.max'), alinear: 'der', celda: (f) => msLegible(f.maxMs) },
]);

const columnasCorridas = (t: TSistema = T_SISTEMA_ES, idioma?: Idioma): ColumnaBase<CorridaCruzada>[] => ([
  { id: 'agente', titulo: t('observabilidad.agente'), principal: true, celda: (c) => <Link href={`/admin/corridas/${c.id}`}>{etiquetaInterruptor(`agente:${c.agente}`, t)}</Link> },
  // Corrida sin flota = del negocio (ventas, 0105): se dice, no se deja en blanco.
  { id: 'flota', titulo: t('observabilidad.flota'), celda: (c) => c.tenantNombre ?? (c.tenantId === null ? t('observabilidad.likida_negocio') : '—') },
  { id: 'estado', titulo: t('salud_sistema.estado'), celda: (c) => { const e = chipCorrida(t)[c.estado] ?? { tono: 'neutral' as TonoEstado, etiqueta: c.estado }; return <StatusChip tono={e.tono}>{e.etiqueta}</StatusChip>; } },
  { id: 'tareas', titulo: t('observabilidad.tareas'), alinear: 'der', celda: (c) => (c.tareasHechas !== null && c.tareasTotal !== null ? t('observabilidad.tareas_de', { hechas: c.tareasHechas, total: c.tareasTotal }) : '—') },
  { id: 'duracion', titulo: t('observabilidad.duracion'), alinear: 'der', celda: (c) => duracion(c.duracionMs) },
  { id: 'inicio', titulo: t('observabilidad.inicio'), celda: (c) => fechaHoraMx(c.inicio, idioma) },
]);

/**
 * Observabilidad — la casa de OPERAR el sistema: el kill switch (0110), la traza de corridas y la latencia medida. `requireSuperadmin()`
 * ya lo hizo el layout para RENDERIZAR; la acción de los interruptores lo repite adentro porque el gateo de la UI solo decide si se
 * pinta el formulario (patrón de administracion.ts).
 *
 * F7: se quitaron los duplicados (el semáforo de Sentry y Vercel vive en Estado, el costo de IA por día en Consumo de IA) y la ventana
 * de la bitácora, que ahora es la pantalla Bitácora con filtros y páginas. La acción de los interruptores no cambió: la fija
 * `page.test.tsx`.
 */
export default async function ObservabilidadPage() {
  const { t, idioma } = await getT('admin_sistema');
  // A39-S05-01/S06-01: puerta PROPIA en el render (el layout no se re-ejecuta en una petición RSC parcial).
  await requireSuperadmin();
  async function accionInterruptor(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t } = await getT('admin_sistema');
    // RE-GATEO: el action es un endpoint público en la práctica — el layout
    // solo protegió el render.
    const { userId } = await requireSuperadmin();
    const id = String(fd.get('id') ?? '');
    const operacion = String(fd.get('operacion') ?? '');
    const motivo = String(fd.get('motivo') ?? '');
    try {
      if (operacion === 'apagar') await apagar(id, motivo, userId);
      else if (operacion === 'encender') await encender(id, userId);
      else return { error: t('observabilidad.operacion_desconocida') };
    } catch (e) {
      return { error: mensajeParaPantalla(e, `${operacion} el interruptor ${id}`, idioma) };
    }
    revalidatePath('/admin/observabilidad');
    return {
      ok: operacion === 'apagar'
        ? t('observabilidad.apagado_los_crons_lo_saltan_desde', { etiquetaInterruptor: etiquetaInterruptor(id, t) })
        : t('observabilidad.encendido_vuelve_a_correr_en_la', { etiquetaInterruptor: etiquetaInterruptor(id, t) }),
    };
  }


  // Cada fuente falla POR SEPARADO y lo dice: los interruptores caídos no pueden esconder las corridas, ni al revés — en un incidente esta
  // página es la que tiene que seguir en pie aunque sea a pedazos.
  const [interruptores, corridas, latencias] = await Promise.all([
    listarInterruptores().catch((): InterruptorParaUi[] | null => null),
    corridasRecientes(15).catch((): CorridaCruzada[] | null => null),
    // E1-A (0700): los p50/p95 se calculan en SQL; cada fuente (rutas, crons, IA) degrada por separado dentro de la función.
    getLatencias(7).catch((): LatenciasMedidas | null => null),
  ]);
  const dias = latencias?.ventanaDias ?? 7;

  return (
    <MarcoPagina titulo={t('observabilidad.observabilidad')} apoyo={t('observabilidad.apagar_un_agente_en_segundos_ver')}>
      <Tarjeta titulo={t('observabilidad.interruptores')}
        estado={interruptores === null ? 'error' : 'ok'} reintentar
        mensaje={t('observabilidad.no_se_pudieron_leer_los_interruptores')}
      >
        <p className="adm-sis-nota">{t('observabilidad.sin_fila_encendido_lo_seguro_es')}</p>
        {interruptores !== null ? <SeccionInterruptores interruptores={interruptores} accion={accionInterruptor} /> : null}
      </Tarjeta>

      <Tarjeta titulo={t('observabilidad.corridas_recientes')} acciones={<BotonEnlace href="/admin/corridas" variante="ghost" tamano="sm">{t('observabilidad.ver_todas')}</BotonEnlace>}
        estado={corridas === null ? 'error' : corridas.length === 0 ? 'vacio' : 'ok'} reintentar
        mensaje={corridas === null ? t('observabilidad.no_se_pudo_leer_el_historial') : t('observabilidad.los_agentes_no_han_corrido_todavia')}
        detalle={t('observabilidad.el_historial_existe_y_esta_vacio')}>
        {corridas !== null ? <TablaBase etiqueta={t('observabilidad.corridas_de_agentes_recientes')} columnas={columnasCorridas(t, idioma)} filas={corridas} idFila={(c) => c.id} densa tarjetaMovil /> : null}
      </Tarjeta>

      {/* ── Latencias medidas (0700) ─────────────────────────────────────── */}
      <Tarjeta titulo={t('observabilidad.latencia_por_ruta_p50_y_p95', { dias })}
        estado={latencias === null || latencias.rutas === null ? 'error' : latencias.rutas.length === 0 ? 'vacio' : 'ok'} reintentar
        mensaje={latencias === null || latencias.rutas === null ? t('observabilidad.no_se_pudo_leer_la_latencia') : t('observabilidad.sin_muestras_todavia')}
        detalle={t('observabilidad.la_tabla_existe_y_esta_vacia')}>
        <p className="adm-sis-nota">{t('observabilidad.percentiles_calculados_en_la_base_rango')}</p>
        {latencias?.rutas ? <TablaBase etiqueta={t('observabilidad.latencia_por_ruta')} columnas={columnasLatencia(t('observabilidad.ruta'), (n) => n, (n) => notaDeLatenciaRuta(n, t), t, idioma)} filas={latencias.rutas} idFila={(f) => f.nombre} densa tarjetaMovil /> : null}
      </Tarjeta>

      <Tarjeta titulo={t('observabilidad.latencia_por_reloj_p50_y_p95', { dias })}
        estado={latencias === null || latencias.crons === null ? 'error' : latencias.crons.length === 0 ? 'vacio' : 'ok'} reintentar
        mensaje={latencias === null || latencias.crons === null ? t('observabilidad.no_se_pudo_leer_la_latencia_2') : t('observabilidad.sin_muestras_todavia')}
        detalle={t('observabilidad.ningun_reloj_ha_corrido_desde_que')}>
        <p className="adm-sis-nota">{t('observabilidad.una_muestra_por_corrida_de_la')}</p>
        {latencias?.crons ? <TablaBase etiqueta={t('observabilidad.latencia_por_reloj')} columnas={columnasLatencia(t('observabilidad.reloj'), (n) => nombreReloj(n, t), undefined, t, idioma)} filas={latencias.crons} idFila={(f) => f.nombre} densa tarjetaMovil /> : null}
      </Tarjeta>

      <Tarjeta titulo={t('observabilidad.latencia_de_la_ia_por_fase', { dias })}
        estado={latencias === null || latencias.ia === null ? 'error' : latencias.ia.length === 0 ? 'vacio' : 'ok'} reintentar
        mensaje={latencias === null || latencias.ia === null ? t('observabilidad.no_se_pudo_leer_la_latencia_3') : t('observabilidad.sin_llamadas_de_ia_en_la')}
        detalle={t('observabilidad.la_base_esta_en_cero_porque')}>
        <p className="adm-sis-nota">{t('observabilidad.las_llamadas_anteriores_a_esta_medicion')}</p>
        {latencias?.ia ? <TablaBase etiqueta={t('observabilidad.duracion_por_fase')} columnas={columnasIa(t, idioma)} filas={latencias.ia} idFila={(f) => f.fase} densa tarjetaMovil /> : null}
      </Tarjeta>

      {interruptores === null && corridas === null && latencias === null ? <EstadoError reintentar>{t('observabilidad.ninguna_de_las_tres_fuentes_respondio')}</EstadoError> : null}

      <div className="adm-sis-acciones">
        <BotonEnlace href="/admin/bitacora" variante="secondary" tamano="sm">{t('observabilidad.ver_la_bitacora_de_acciones')}</BotonEnlace>
        <BotonEnlace href="/admin/salud-sistema" variante="secondary" tamano="sm">{t('observabilidad.estado_del_sistema')}</BotonEnlace>
        <BotonEnlace href="/admin/consumo" variante="secondary" tamano="sm">{t('observabilidad.gasto_de_ia_por_dia')}</BotonEnlace>
      </div>
    </MarcoPagina>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('observabilidad.observabilidad') };
}
