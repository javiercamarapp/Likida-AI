import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSuperadmin } from '@/lib/auth/guard';
import {
  corridasFiltradas, CORRIDAS_POR_PAGINA, ESTADOS_CORRIDA, type CorridaCruzada,
} from '@/lib/admin/corridas-cruzadas';
import { getAgentesParados } from '@/lib/admin/agentes-parados';
import { leerResumenBandeja } from '@/lib/admin/cola-aprobacion';
import { opcionesBitacora } from '@/lib/admin/bitacora';
import { ahoraMs } from '@/lib/saludo';
import { fechaHoraMx, usd4 } from '@/lib/formato';
import {
  BarraFiltros, EstadoError, FiltroOpciones, StatusChip, Tarjeta, type OpcionFiltro, type TonoEstado,
} from '../../ui-v2/componentes';
import { MapaCalor } from '../../ui-v2/graficas';
import { getT } from '@/lib/i18n/servidor';
import { BLOQUES_HORA, matrizDeCorridas } from './calor';
import { TablaLista, type ColumnaTabla } from '../../ui-v2/datos';
import { etiquetaInterruptorTr, etiquetaInterruptor } from '../observabilidad/etiquetas';
import { BloqueAgentesParados } from '../escalaciones/agentes-parados';
import { PiePaginas } from '../pie-paginas';
import { EsqueletoTablaMaestra } from '../../ui-v2/esqueletos';
import '../sistema.css';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import type { Idioma } from '@/lib/i18n/idioma';

export const dynamic = 'force-dynamic';

const chipTr = (tx: TSistema = T_SISTEMA_ES): Record<string, { tono: TonoEstado; etiqueta: string }> => ({
  ok: { tono: 'ok', etiqueta: 'OK' },
  parcial: { tono: 'warn', etiqueta: tx('observabilidad.parcial') },
  fallo: { tono: 'bad', etiqueta: tx('observabilidad.fallo') },
});

function duracion(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  return `${Math.round(ms / 6_000) / 10} min`;
}

/** Los agentes del catálogo de palancas, por su nombre (el filtro compara el id exacto; un nombre mal escrito jamás coincidiría). */
const opcionesAgente = (tx: TSistema = T_SISTEMA_ES): OpcionFiltro[] => ([
  { valor: '', rotulo: tx('corridas.cualquier_agente') },
  ...Object.entries(etiquetaInterruptorTr(tx)).filter(([id]) => id.startsWith('agente:')).map(([id, nombre]) => ({ valor: id.slice('agente:'.length), rotulo: nombre })),
]);

interface SearchParams { agente?: string; estado?: string; tenant?: string; p?: string }

const columnasTr = (tx: TSistema = T_SISTEMA_ES, idioma?: Idioma): ColumnaTabla<CorridaCruzada>[] => ([
  {
    id: 'agente', titulo: tx('observabilidad.agente'), principal: true,
    celda: (c) => (
      <>
        <Link href={`/admin/corridas/${c.id}`}>{etiquetaInterruptor(c.agente, tx)}</Link>
        {/* EL ERROR, EN LA LISTA. Estaba solo dentro de la traza, una por una: con 50 corridas y tres fallos, encontrar el motivo eran tres
            clics a ciegas. El motivo ya viene REDACTADO para una persona (no un stack), así que se puede pintar tal cual. */}
        {c.error !== null && c.error !== '' ? <span className="adm-sis-error-fila" title={c.error}>{c.error}</span> : null}
      </>
    ),
  },
  { id: 'flota', titulo: tx('observabilidad.flota'), celda: (c) => c.tenantNombre ?? tx('observabilidad.likida_negocio') },
  { id: 'estado', titulo: tx('salud_sistema.estado'), celda: (c) => { const e = chipTr(tx)[c.estado] ?? { tono: 'neutral' as TonoEstado, etiqueta: c.estado }; return <StatusChip tono={e.tono}>{e.etiqueta}</StatusChip>; } },
  { id: 'inicio', titulo: tx('observabilidad.inicio'), corta: true, celda: (c) => fechaHoraMx(c.inicio, idioma) },
  {
    id: 'duracion', titulo: tx('observabilidad.duracion'),
    // Tareas: ambos o ninguno — la regla de la casa.
    celda: (c) => <>{duracion(c.duracionMs)}<span className="adm-sis-sub">{c.tareasHechas !== null && c.tareasTotal !== null ? tx('corridas.tareas_de_total', { hechas: c.tareasHechas, total: c.tareasTotal }) : tx('corridas.sin_tareas_medidas')}</span></>,
  },
  {
    id: 'gasto', titulo: tx('corridas.gasto'), alinear: 'der',
    // `usd4` y no `usd`: una corrida cuesta céntimos de céntimo, y `usd` los redondearía a US$0.00, que se lee «no gastó». NULL se pinta
    // «—» con su porqué: no se midió, no es que saliera gratis.
    celda: (c) => (c.costoUsd === null
      ? <span title={tx('corridas.esta_corrida_no_midio_su_gasto')}>—</span>
      : usd4(c.costoUsd)),
  },
]);

/**
 * EL ÍNDICE DE CORRIDAS — /admin/corridas (16-ago-2026; filtros + paginación ADM-10, auditoría 24).
 *
 * Existía solo /admin/corridas/[id], y DOS mapas del copiloto mandaban al usuario a esta URL: el chip de fuente de `traza_corrida`
 * aterrizaba en un 404. Esta página lo cerró con la MISMA fuente que ya pinta el Inicio, con filtro GET y total real. F7: el bloque
 * «Agentes que no corrieron y por qué» vive también aquí (es la otra mitad de la pregunta «qué pasó con las corridas»).
 */
export default async function IndiceCorridas({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { t: tx, idioma } = await getT('admin_sistema');
  await requireSuperadmin();
  const sp = await searchParams;
  const agente = (sp.agente ?? '').trim();
  const estado = (sp.estado ?? '').trim();
  const tenant = (sp.tenant ?? '').trim();
  const pagina = Math.max(1, Number.parseInt(sp.p ?? '1', 10) || 1);
  const hayFiltro = agente !== '' || estado !== '' || tenant !== '';

  let resultado: { corridas: CorridaCruzada[]; pagina: number; paginas: number; total: number } | null = null;
  try {
    resultado = await corridasFiltradas({
      agente: agente || undefined,
      estado: estado || undefined,
      tenantId: tenant || undefined,
      pagina,
    });
  } catch {
    resultado = null;
  }
  // Nunca lanzan: `null` = sin dato (y el bloque lo dice).
  const [parados, cola, opciones] = await Promise.all([
    getAgentesParados(ahoraMs()), leerResumenBandeja(ahoraMs()), opcionesBitacora(),
  ]);
  const flotas: OpcionFiltro[] | null = opciones.flotas === null ? null : [{ valor: '', rotulo: tx('corridas.todas_las_flotas') }, ...opciones.flotas.map((f) => ({ valor: f.id, rotulo: f.nombre }))];
  const params = { agente: agente || undefined, estado: estado || undefined, tenant: tenant || undefined };
  const { t } = await getT('graficas');
  const calor = resultado !== null && resultado.corridas.length > 0 ? matrizDeCorridas(resultado.corridas.map((c) => c.inicio), t('corridas.calor.dias').split(',')) : null;

  return (
    <EsqueletoTablaMaestra
      titulo={tx('corridas.corridas')}
      apoyo={tx('corridas.las_corridas_de_los_agentes_en')}
      cifras={resultado === null ? undefined : [
        { etiqueta: tx('corridas.corridas'), valor: resultado.total, formato: 'entero' },
        { etiqueta: tx('corridas.kpi_ok'), valor: resultado.corridas.filter((c) => c.estado === 'ok').length, formato: 'entero', nota: tx('corridas.kpi_pagina_nota') },
        { etiqueta: tx('corridas.kpi_parciales'), valor: resultado.corridas.filter((c) => c.estado === 'parcial').length, formato: 'entero', tono: resultado.corridas.some((c) => c.estado === 'parcial') ? 'warn' : undefined },
        { etiqueta: tx('corridas.kpi_fallos'), valor: resultado.corridas.filter((c) => c.estado === 'fallo').length, formato: 'entero', tono: resultado.corridas.some((c) => c.estado === 'fallo') ? 'bad' : undefined },
        parados === null
          ? { etiqueta: tx('corridas.kpi_parados'), valor: null, estado: 'vacio' as const }
          : { etiqueta: tx('corridas.kpi_parados'), valor: parados.parados.length, formato: 'entero' as const, tono: parados.parados.length > 0 ? 'warn' as const : undefined },
      ]}
      filtros={
      <BarraFiltros accion="/admin/corridas" enLinea buscar etiqueta={tx('corridas.filtrar_corridas')} nActivos={[agente, estado, tenant].filter(Boolean).length} limpiarHref="/admin/corridas">
        <FiltroOpciones etiqueta={tx('observabilidad.agente')} nombre="agente" valor={agente} opciones={opcionesAgente(tx)} />
        <FiltroOpciones etiqueta={tx('salud_sistema.estado')} nombre="estado" valor={estado} opciones={[{ valor: '', rotulo: tx('corridas.cualquier_estado') }, ...ESTADOS_CORRIDA.map((e) => ({ valor: e, rotulo: chipTr(tx)[e].etiqueta }))]} />
        {flotas ? <FiltroOpciones etiqueta={tx('observabilidad.flota')} nombre="tenant" valor={tenant} opciones={flotas} /> : null}
      </BarraFiltros>}
    >
      {resultado === null ? (
        <EstadoError reintentar>{tx('corridas.no_se_pudieron_leer_las_corridas')}</EstadoError>
      ) : (
        <>
          <TablaLista<CorridaCruzada>
            etiqueta={tx('corridas.corridas_de_agentes')} columnas={columnasTr(tx, idioma)} filas={resultado.corridas} idFila={(c) => c.id} base="/admin/corridas" params={params}
            vacio={hayFiltro
              ? { titulo: tx('corridas.ninguna_corrida_coincide'), texto: tx('corridas.ninguna_corrida_coincide_con_el_filtro') }
              : { titulo: tx('corridas.aun_no_hay_corridas'), texto: tx('corridas.cada_corrida_de_un_agente_deja') }}
          />
          {calor !== null && calor.contadas > 0 ? (
            <Tarjeta titulo={t('corridas.calor.titulo')} elevar entra="tarjeta">
              <MapaCalor etiqueta={t('corridas.calor.etiqueta')} columnas={BLOQUES_HORA} filas={calor.filas} mostrarValores />
              <p className="adm-sis-sub">{t('corridas.calor.nota', { n: calor.contadas })}</p>
            </Tarjeta>
          ) : null}
          {resultado.total > 0 ? (
            <PiePaginas base="/admin/corridas" params={params} pagina={resultado.pagina} paginas={resultado.paginas} total={resultado.total} tamano={CORRIDAS_POR_PAGINA} unidad="corridas" />
          ) : null}
        </>
      )}

      <BloqueAgentesParados datos={parados} cola={cola} resumen />
    </EsqueletoTablaMaestra>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('corridas.corridas') };
}
