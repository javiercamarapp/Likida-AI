import { uniformes } from '@/app/admin/cifras-uniformes';
import { getT } from '@/lib/i18n/servidor';
import { nombreFuenteTr } from '@/lib/i18n/rotulos_tr';
import { urlCasoExamen } from '@/lib/admin/casos-regresion';
import type { Metadata } from 'next';
import {
  Inbox, ShieldCheck, Bot, Wrench, ReceiptText, LifeBuoy, ClipboardCheck, ArrowRight,
} from 'lucide-react';
import { requireSuperadmin } from '@/lib/auth/guard';
import {
  getBandejaEscalaciones, conteoDeFuente,
  type BandejaEscalaciones, type FuenteEscalacion, type ItemEscalacion,
} from '@/lib/admin/escalaciones';
import { getAgentesParados } from '@/lib/admin/agentes-parados';
import { leerResumenBandeja } from '@/lib/admin/cola-aprobacion';
import { ahoraMs } from '@/lib/saludo';
import { fechaHoraMx, fechaMx, numero } from '@/lib/formato';
import { Aviso, BotonEnlace, EstadoVacio, StatusChip, TablaBase, type ColumnaBase } from '../../ui-v2/componentes';
import { EsqueletoTablaMaestra } from '../../ui-v2/esqueletos';
import { BloqueAgentesParados } from './agentes-parados';
import '../bandeja.css';

export const dynamic = 'force-dynamic';

const ICONO_FUENTE: Record<FuenteEscalacion, typeof Inbox> = {
  arco: ShieldCheck,
  corridas: Bot,
  talachas: Wrench,
  facturas_proveedor: ReceiptText,
  tickets: LifeBuoy,
  liquidaciones: ClipboardCheck,
};

/** "hace 3 h" / "hace 2 d" contra el MISMO reloj del servidor con el que se calculó el SLA de los tickets (ahoraMs inyectado a la
 *  bandeja) — dos relojes en la misma fila terminan contándose historias distintas. */
function edadDe(desdeIso: string, ahora: number): string {
  const horas = (ahora - new Date(desdeIso).getTime()) / 3_600_000;
  if (Number.isNaN(horas)) return '—';
  if (horas < 1) return 'hace menos de 1 h';
  if (horas < 48) return `hace ${Math.floor(horas)} h`;
  return `hace ${Math.floor(horas / 24)} d`;
}

const FUENTES: FuenteEscalacion[] = ['arco', 'corridas', 'talachas', 'facturas_proveedor', 'tickets', 'liquidaciones'];

/** Cuántos pendientes se listan de una vez. Los CONTEOS de arriba siguen siendo de toda la cola — lo acotado es la tabla, y se declara. */
const TOPE_COLA = 50;

/**
 * ESCALACIONES — la bandeja del superadmin: UNA cola con todo lo que hoy espera a un humano, ordenada por urgencia. Nada aquí se mide
 * nuevo: son las seis lecturas de `lib/admin/escalaciones.ts` (que también alimenta la campana y el número de la pestaña). Los errores
 * van POR FUENTE: una fuente que no se pudo leer lo dice ("no se pudo leer" ≠ 0) y la cola sigue enseñando lo que sí se leyó.
 * Piloto de `TablaBase` (lista corta en memoria, directo en la rejilla, nunca dentro de una tarjeta).
 *
 * ADM-4: las cifras usan `conteoDeFuente` (total REAL), no el tamaño de una lista topada.
 * Además: «Agentes que no corrieron y por qué» (`getAgentesParados`), el P0 de visibilidad de la auditoría.
 */
export default async function EscalacionesPage() {
  await requireSuperadmin();
  const { t } = await getT('admin_inicio');
  const ahora = ahoraMs();
  // Nunca lanzan: los fallos de lectura vienen por valor (bandeja) o como null (parados, cola).
  const [bandeja, parados, cola]: [BandejaEscalaciones, Awaited<ReturnType<typeof getAgentesParados>>, Awaited<ReturnType<typeof leerResumenBandeja>>] =
    await Promise.all([getBandejaEscalaciones(ahora), getAgentesParados(ahora), leerResumenBandeja(ahora)]);
  // La cola viene ordenada por urgencia, así que recortar por la cola es recortar lo menos urgente.
  const cola50 = bandeja.cola.slice(0, TOPE_COLA);
  const recortada = bandeja.cola.length > TOPE_COLA;

  const ilegibles = FUENTES.filter((f) => bandeja.fuentes[f].error !== null);
  const legibles = FUENTES.filter((f) => bandeja.fuentes[f].error === null);

  // Total real: la suma de los conteos reales de las fuentes legibles; sin dato si alguna legible no trae su conteo (nunca una suma a medias).
  const conteosLegibles = legibles.map((f) => conteoDeFuente(f, bandeja.conteos));
  const porResolver = ilegibles.length === 0 && conteosLegibles.every((c): c is number => c !== null) ? conteosLegibles.reduce((a, c) => a + c, 0) : null;

  const { t: tMon } = await getT('monitoreo');
  const { t: tSis } = await getT('admin_sistema');
  const columnas: ColumnaBase<ItemEscalacion>[] = [
    {
      id: 'que', titulo: t('escalaciones.que_espera'), principal: true,
      celda: (it) => <>{it.titulo}{it.detalle ? <span className="bj-nota"> {it.detalle}</span> : null}</>,
    },
    {
      id: 'fuente', titulo: t('escalaciones.fuente'),
      celda: (it) => { const Icono = ICONO_FUENTE[it.fuente]; return <span className="bj-fuente"><Icono width={13} height={13} strokeWidth={1.75} aria-hidden="true" />{nombreFuenteTr(it.fuente, tSis)}</span>; },
    },
    { id: 'flota', titulo: t('escalaciones.flota'), celda: (it) => it.tenantNombre },
    { id: 'desde', titulo: t('escalaciones.desde'), celda: (it) => `${fechaHoraMx(it.desde)} · ${edadDe(it.desde, ahora)}` },
    {
      id: 'vence', titulo: t('escalaciones.vence'),
      celda: (it) => (it.vence
        ? <StatusChip tono={new Date(it.vence).getTime() < ahora ? 'bad' : 'neutral'}>{fechaMx(it.vence)}</StatusChip>
        : '—'),
    },
    {
      id: 'resolver', titulo: t('escalaciones.se_resuelve_en'), alinear: 'der',
      // Sin pantalla a la cual llevar, se dice — un link que rebota es peor que ninguno.
      celda: (it) => (it.href
        ? <BotonEnlace href={it.href} variante="secondary" tamano="sm" className="bj-nowrap">Resolver <ArrowRight width={11} height={11} strokeWidth={1.75} aria-hidden="true" /></BotonEnlace>
        : 'sin ficha'),
    },
    { id: 'caso', titulo: '', alinear: 'der', celda: (it) => <BotonEnlace href={urlCasoExamen(it)} variante="ghost" tamano="sm" className="bj-nowrap">{tMon('caso.boton')}</BotonEnlace> },
  ];

  return (
    <EsqueletoTablaMaestra
      titulo={t('escalaciones.escalaciones')}
      apoyo={t('escalaciones.todo_lo_que_espera')}
      etiquetaCifras={t('escalaciones.escalaciones_por_fuente')}
      cifras={uniformes([
        // Tira de 4 celdas con rótulo de UNA línea (Rovaq): el total con su barra segmentada por fuente (los seis conteos reales),
        // lo vencido, lo que no se pudo leer y los agentes que no corrieron. Los conteos por fuente van como chips sobre la cola.
        porResolver === null
          ? { etiqueta: t('escalaciones.kpi_por_resolver'), valor: null, estado: 'vacio' as const, mensaje: t('escalaciones.kpi_sin_leer_todo') }
          : { etiqueta: t('escalaciones.kpi_por_resolver'), valor: porResolver, formato: 'entero' as const, segmentos: legibles.map((f) => ({ etiqueta: nombreFuenteTr(f, tSis), valor: conteoDeFuente(f, bandeja.conteos) })) },
        bandeja.conteos.ticketsVencidos === null
          ? { etiqueta: t('escalaciones.kpi_tickets_vencidos'), valor: null, estado: 'vacio' as const, mensaje: t('escalaciones.kpi_sin_leer_todo') }
          : { etiqueta: t('escalaciones.kpi_tickets_vencidos'), valor: bandeja.conteos.ticketsVencidos, formato: 'entero' as const, tono: bandeja.conteos.ticketsVencidos > 0 ? 'bad' as const : undefined },
        { etiqueta: t('escalaciones.kpi_fuentes_sin_leer'), valor: ilegibles.length, formato: 'entero' as const, tono: ilegibles.length > 0 ? 'bad' as const : undefined },
        parados === null
          ? { etiqueta: t('escalaciones.kpi_agentes_sin_correr'), valor: null, estado: 'vacio' as const, mensaje: t('escalaciones.kpi_sin_leer_todo') }
          : { etiqueta: t('escalaciones.kpi_agentes_sin_correr'), valor: parados.parados.length, formato: 'entero' as const, tono: parados.parados.length > 0 ? 'warn' as const : undefined },
      ])}
      /* Fuentes que NO se pudieron leer — dicho, nunca un 0. */
      avisos={ilegibles.length === 0 ? null : ilegibles.map((f) => (
        <Aviso key={f} tono="error" titulo={t('escalaciones.no_se_pudo_leer', { NOMBRE_FUENTE: nombreFuenteTr(f, tSis) })}>
          {t('escalaciones.no_es_que_haya')} {bandeja.fuentes[f].error}
        </Aviso>
      ))}
    >

      {bandeja.cola.length === 0 ? (
        legibles.length > 0 && (
          <section className="bj-bloque bj-caja" aria-labelledby="cola-escalaciones">
          <h2 className="bj-titulo" id="cola-escalaciones">{t('escalaciones.la_cola_lo_mas')}</h2>
          <EstadoVacio titulo={ilegibles.length === 0 ? t('escalaciones.la_cola_esta_vacia') : t('escalaciones.sin_pendientes_en_lo')}>
            {ilegibles.length === 0 ? (
              <>
                
                {t('escalaciones.las_seis_fuentes_se')}
              </>
            ) : (
              <>
                {ilegibles.length === 1 ? t('escalaciones.sin_leer_una') : t('escalaciones.sin_leer_varias', { n: ilegibles.length })}
              </>
            )}
          </EstadoVacio>
          </section>
        )
      ) : (
        <section className="bj-bloque bj-caja" aria-labelledby="cola-escalaciones">
          <h2 className="bj-titulo" id="cola-escalaciones">{t('escalaciones.la_cola_lo_mas')}</h2>
          <ul className="bj-chips-fuente" aria-label={t('escalaciones.escalaciones_por_fuente')}>
            {legibles.map((f) => {
              const Icono = ICONO_FUENTE[f];
              const n = conteoDeFuente(f, bandeja.conteos);
              return <li key={f}><span className="bj-fuente"><Icono width={13} height={13} strokeWidth={1.75} aria-hidden="true" />{nombreFuenteTr(f, tSis)}</span><b>{n === null ? '—' : numero(n)}</b></li>;
            })}
          </ul>
          <TablaBase
            etiqueta={t('escalaciones.cola_de_escalaciones')} columnas={columnas} filas={cola50}
            idFila={(it) => `${it.fuente}-${it.desde}-${it.titulo}`} tarjetaMovil
          />
          <p className="bj-nota">
            {recortada
              ? t('escalaciones.se_listan_las_mas', { TOPE_COLA: numero(TOPE_COLA), length: numero(bandeja.cola.length) })
              : t(bandeja.cola.length === 1 ? 'escalaciones.pendiente_en_cola.uno' : 'escalaciones.pendiente_en_cola.otros', { n: numero(bandeja.cola.length) })}
            {' '}{t('escalaciones.orden_explicacion')}
            {recortada && t('escalaciones.los_conteos_de_arriba')}
          </p>
        </section>
      )}

      <BloqueAgentesParados datos={parados} cola={cola} t={t} tope={10} />
    </EsqueletoTablaMaestra>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_inicio');
  return { title: t('escalaciones.escalaciones') };
}
