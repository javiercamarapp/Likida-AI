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
import { NOMBRE_RELOJ } from '../crons/estado-relojes';
import { CRONS, type CronId } from '@/lib/admin/salud';
import type { ResultadoAccion } from '../ui/forma';
import '../sistema.css';

export const dynamic = 'force-dynamic';

/** El estado de la corrida como chip; un valor fuera del dominio se pinta crudo en neutro — visible, no roto. */
const CHIP_CORRIDA: Record<string, { tono: TonoEstado; etiqueta: string }> = {
  ok: { tono: 'ok', etiqueta: 'OK' },
  parcial: { tono: 'warn', etiqueta: 'Parcial' },
  fallo: { tono: 'bad', etiqueta: 'Fallo' },
};

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
const nombreReloj = (id: string): string => ((CRONS as readonly string[]).includes(id) ? NOMBRE_RELOJ[id as CronId] : id);

function columnasLatencia(etiqueta: string, nombre: (n: string) => string, notas?: (n: string) => string | null): ColumnaBase<FilaLatencia>[] {
  return [
    { id: 'nombre', titulo: etiqueta, principal: true, celda: (f) => <>{nombre(f.nombre)}{notas?.(f.nombre) ? <span className="adm-sis-sub">mide {notas(f.nombre)}</span> : null}</> },
    { id: 'muestras', titulo: 'Muestras', alinear: 'der', celda: (f) => numero(f.muestras) },
    { id: 'p50', titulo: 'p50', alinear: 'der', celda: (f) => msLegible(f.p50Ms) },
    { id: 'p95', titulo: 'p95', alinear: 'der', celda: (f) => msLegible(f.p95Ms) },
    { id: 'max', titulo: 'Máx.', alinear: 'der', celda: (f) => msLegible(f.maxMs) },
    { id: 'fallos', titulo: 'Fallos', alinear: 'der', celda: (f) => (f.fallos > 0 ? <StatusChip tono="bad">{numero(f.fallos)}</StatusChip> : numero(f.fallos)) },
  ];
}

const COLUMNAS_IA: ColumnaBase<FilaLatenciaIa>[] = [
  { id: 'fase', titulo: 'Fase', principal: true, celda: (f) => f.fase },
  { id: 'muestras', titulo: 'Medidas', alinear: 'der', celda: (f) => numero(f.muestras) },
  { id: 'sin', titulo: 'Sin duración', alinear: 'der', celda: (f) => numero(f.sinDuracion) },
  { id: 'p50', titulo: 'p50', alinear: 'der', celda: (f) => msLegible(f.p50Ms) },
  { id: 'p95', titulo: 'p95', alinear: 'der', celda: (f) => msLegible(f.p95Ms) },
  { id: 'max', titulo: 'Máx.', alinear: 'der', celda: (f) => msLegible(f.maxMs) },
];

const COLUMNAS_CORRIDAS: ColumnaBase<CorridaCruzada>[] = [
  { id: 'agente', titulo: 'Agente', principal: true, celda: (c) => <Link href={`/admin/corridas/${c.id}`}>{etiquetaInterruptor(`agente:${c.agente}`)}</Link> },
  // Corrida sin flota = del negocio (ventas, 0105): se dice, no se deja en blanco.
  { id: 'flota', titulo: 'Flota', celda: (c) => c.tenantNombre ?? (c.tenantId === null ? 'Likida (negocio)' : '—') },
  { id: 'estado', titulo: 'Estado', celda: (c) => { const e = CHIP_CORRIDA[c.estado] ?? { tono: 'neutral' as TonoEstado, etiqueta: c.estado }; return <StatusChip tono={e.tono}>{e.etiqueta}</StatusChip>; } },
  { id: 'tareas', titulo: 'Tareas', alinear: 'der', celda: (c) => (c.tareasHechas !== null && c.tareasTotal !== null ? `${c.tareasHechas} de ${c.tareasTotal}` : '—') },
  { id: 'duracion', titulo: 'Duración', alinear: 'der', celda: (c) => duracion(c.duracionMs) },
  { id: 'inicio', titulo: 'Inicio', celda: (c) => fechaHoraMx(c.inicio) },
];

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
  // A39-S05-01/S06-01: puerta PROPIA en el render (el layout no se re-ejecuta en una petición RSC parcial).
  await requireSuperadmin();
  async function accionInterruptor(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    // RE-GATEO: el action es un endpoint público en la práctica — el layout
    // solo protegió el render.
    const { userId } = await requireSuperadmin();
    const id = String(fd.get('id') ?? '');
    const operacion = String(fd.get('operacion') ?? '');
    const motivo = String(fd.get('motivo') ?? '');
    try {
      if (operacion === 'apagar') await apagar(id, motivo, userId);
      else if (operacion === 'encender') await encender(id, userId);
      else return { error: 'Operación desconocida.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, `${operacion} el interruptor ${id}`) };
    }
    revalidatePath('/admin/observabilidad');
    return {
      ok: operacion === 'apagar'
        ? `${etiquetaInterruptor(id)} APAGADO. Los crons lo saltan desde su siguiente corrida (responden 200 con "saltado" — apagado a propósito no es fallo). Quedó firmado en la bitácora.`
        : `${etiquetaInterruptor(id)} encendido. Vuelve a correr en la siguiente corrida programada.`,
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
    <MarcoPagina titulo="Observabilidad" apoyo="Apagar un agente en segundos, ver sus corridas recientes y cuánto tarda el sistema.">
      <Tarjeta titulo="Interruptores"
        estado={interruptores === null ? 'error' : 'ok'} reintentar
        mensaje="No se pudieron leer los interruptores. La consulta falló: no es que estén todos encendidos, es que no se pudo mirar. Los relojes, ante lo mismo, NO corren (fallan cerrado)."
      >
        <p className="adm-sis-nota">
          Sin fila = encendido: lo seguro es que el sistema corra. Apagar exige motivo. La palanca es global por agente, no por flota, y los relojes fallan cerrado: si no pueden leerla, no corren.
          Desde ⌘K también se mueven.
        </p>
        {interruptores !== null ? <SeccionInterruptores interruptores={interruptores} accion={accionInterruptor} /> : null}
      </Tarjeta>

      <Tarjeta titulo="Corridas recientes" acciones={<BotonEnlace href="/admin/corridas" variante="ghost" tamano="sm">Ver todas</BotonEnlace>}
        estado={corridas === null ? 'error' : corridas.length === 0 ? 'vacio' : 'ok'} reintentar
        mensaje={corridas === null ? 'No se pudo leer el historial de corridas. La consulta falló: no es que los agentes no hayan corrido, es que no se pudo mirar.' : 'Los agentes no han corrido todavía'}
        detalle="El historial existe y está vacío de verdad: la base está en cero porque no hay clientes operando, no porque falte código.">
        {corridas !== null ? <TablaBase etiqueta="Corridas de agentes recientes" columnas={COLUMNAS_CORRIDAS} filas={corridas} idFila={(c) => c.id} densa tarjetaMovil /> : null}
      </Tarjeta>

      {/* ── Latencias medidas (0700) ─────────────────────────────────────── */}
      <Tarjeta titulo={`Latencia por ruta (p50 y p95, ${dias} días)`}
        estado={latencias === null || latencias.rutas === null ? 'error' : latencias.rutas.length === 0 ? 'vacio' : 'ok'} reintentar
        mensaje={latencias === null || latencias.rutas === null ? 'No se pudo leer la latencia de rutas. La consulta falló: no es que no haya tráfico, es que no se pudo mirar.' : 'Sin muestras todavía'}
        detalle="La tabla existe y está vacía de verdad. Se llena sola con el tráfico de las rutas medidas (salud, webhook de WhatsApp, chat e ingesta del panel).">
        <p className="adm-sis-nota">
          Percentiles calculados en la base (rango más cercano: un valor que de verdad ocurrió). Solo se mide una de cada diez peticiones, sin sesgo hacia lo lento: el p95 de pocas muestras es una estimación, no una garantía.
          Cada ruta mide hasta que devuelve su respuesta; en las que contestan antes de terminar su trabajo (WhatsApp, chat) la nota junto al nombre dice hasta dónde.
        </p>
        {latencias?.rutas ? <TablaBase etiqueta="Latencia por ruta" columnas={columnasLatencia('Ruta', (n) => n, notaDeLatenciaRuta)} filas={latencias.rutas} idFila={(f) => f.nombre} densa tarjetaMovil /> : null}
      </Tarjeta>

      <Tarjeta titulo={`Latencia por reloj (p50 y p95, ${dias} días)`}
        estado={latencias === null || latencias.crons === null ? 'error' : latencias.crons.length === 0 ? 'vacio' : 'ok'} reintentar
        mensaje={latencias === null || latencias.crons === null ? 'No se pudo leer la latencia de los relojes. La consulta falló: no es que no hayan corrido, es que no se pudo mirar.' : 'Sin muestras todavía'}
        detalle="Ningún reloj ha corrido desde que existe la medición.">
        <p className="adm-sis-nota">Una muestra por corrida, de la puerta del reloj a su latido. Los saltos por palanca no cuentan (responden en milisegundos sin trabajar y hundirían el p50).</p>
        {latencias?.crons ? <TablaBase etiqueta="Latencia por reloj" columnas={columnasLatencia('Reloj', nombreReloj)} filas={latencias.crons} idFila={(f) => f.nombre} densa tarjetaMovil /> : null}
      </Tarjeta>

      <Tarjeta titulo={`Latencia de la IA por fase (p50 y p95, ${dias} días)`}
        estado={latencias === null || latencias.ia === null ? 'error' : latencias.ia.length === 0 ? 'vacio' : 'ok'} reintentar
        mensaje={latencias === null || latencias.ia === null ? 'No se pudo leer la latencia de la IA. La consulta falló: no es que no haya llamadas, es que no se pudo mirar.' : 'Sin llamadas de IA en la ventana'}
        detalle="La base está en cero porque no hay clientes operando, no porque falte código.">
        <p className="adm-sis-nota">
          Las llamadas anteriores a esta medición, y las fases cuyo código aún no lleva cronómetro, quedan SIN duración: se cuentan aparte, no como cero.
          Siguen sin medirse la tasa de éxito de las herramientas, la de escalamiento a humano y el tiempo de resolución de punta a punta. La traza de una corrida sí existe: se abre desde la lista de arriba.
        </p>
        {latencias?.ia ? <TablaBase etiqueta="Duración por fase" columnas={COLUMNAS_IA} filas={latencias.ia} idFila={(f) => f.fase} densa tarjetaMovil /> : null}
      </Tarjeta>

      {interruptores === null && corridas === null && latencias === null ? <EstadoError reintentar>Ninguna de las tres fuentes respondió: probablemente la base está caída.</EstadoError> : null}

      <div className="adm-sis-acciones">
        <BotonEnlace href="/admin/bitacora" variante="secondary" tamano="sm">Ver la bitácora de acciones</BotonEnlace>
        <BotonEnlace href="/admin/salud-sistema" variante="secondary" tamano="sm">Estado del sistema</BotonEnlace>
        <BotonEnlace href="/admin/consumo" variante="secondary" tamano="sm">Gasto de IA por día</BotonEnlace>
      </div>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Observabilidad' };
