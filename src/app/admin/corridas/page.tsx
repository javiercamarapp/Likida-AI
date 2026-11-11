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
  BarraFiltros, EstadoError, FiltroOpciones, MarcoPagina, StatusChip, type OpcionFiltro, type TonoEstado,
} from '../../ui-v2/componentes';
import { TablaLista, type ColumnaTabla } from '../../ui-v2/datos';
import { ETIQUETA_INTERRUPTOR, etiquetaInterruptor } from '../observabilidad/etiquetas';
import { BloqueAgentesParados } from '../escalaciones/agentes-parados';
import { PiePaginas } from '../pie-paginas';
import '../sistema.css';

export const dynamic = 'force-dynamic';

const CHIP: Record<string, { tono: TonoEstado; etiqueta: string }> = {
  ok: { tono: 'ok', etiqueta: 'OK' },
  parcial: { tono: 'warn', etiqueta: 'Parcial' },
  fallo: { tono: 'bad', etiqueta: 'Fallo' },
};

function duracion(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  return `${Math.round(ms / 6_000) / 10} min`;
}

/** Los agentes del catálogo de palancas, por su nombre (el filtro compara el id exacto; un nombre mal escrito jamás coincidiría). */
const OPCIONES_AGENTE: OpcionFiltro[] = [
  { valor: '', rotulo: 'Cualquier agente' },
  ...Object.entries(ETIQUETA_INTERRUPTOR).filter(([id]) => id.startsWith('agente:')).map(([id, nombre]) => ({ valor: id.slice('agente:'.length), rotulo: nombre })),
];

interface SearchParams { agente?: string; estado?: string; tenant?: string; p?: string }

const COLUMNAS: ColumnaTabla<CorridaCruzada>[] = [
  {
    id: 'agente', titulo: 'Agente', principal: true,
    celda: (c) => (
      <>
        <Link href={`/admin/corridas/${c.id}`}>{etiquetaInterruptor(c.agente)}</Link>
        {/* EL ERROR, EN LA LISTA. Estaba solo dentro de la traza, una por una: con 50 corridas y tres fallos, encontrar el motivo eran tres
            clics a ciegas. El motivo ya viene REDACTADO para una persona (no un stack), así que se puede pintar tal cual. */}
        {c.error !== null && c.error !== '' ? <span className="adm-sis-error-fila" title={c.error}>{c.error}</span> : null}
      </>
    ),
  },
  { id: 'flota', titulo: 'Flota', celda: (c) => c.tenantNombre ?? 'Likida (negocio)' },
  { id: 'estado', titulo: 'Estado', celda: (c) => { const e = CHIP[c.estado] ?? { tono: 'neutral' as TonoEstado, etiqueta: c.estado }; return <StatusChip tono={e.tono}>{e.etiqueta}</StatusChip>; } },
  { id: 'inicio', titulo: 'Inicio', corta: true, celda: (c) => fechaHoraMx(c.inicio) },
  {
    id: 'duracion', titulo: 'Duración',
    // Tareas: ambos o ninguno — la regla de la casa.
    celda: (c) => <>{duracion(c.duracionMs)}<span className="adm-sis-sub">{c.tareasHechas !== null && c.tareasTotal !== null ? `${c.tareasHechas} de ${c.tareasTotal} tareas` : 'sin tareas medidas'}</span></>,
  },
  {
    id: 'gasto', titulo: 'Gasto', alinear: 'der',
    // `usd4` y no `usd`: una corrida cuesta céntimos de céntimo, y `usd` los redondearía a US$0.00, que se lee «no gastó». NULL se pinta
    // «—» con su porqué: no se midió, no es que saliera gratis.
    celda: (c) => (c.costoUsd === null
      ? <span title="Esta corrida no midió su gasto. No significa que no gastara.">—</span>
      : usd4(c.costoUsd)),
  },
];

/**
 * EL ÍNDICE DE CORRIDAS — /admin/corridas (16-ago-2026; filtros + paginación ADM-10, auditoría 24).
 *
 * Existía solo /admin/corridas/[id], y DOS mapas del copiloto mandaban al usuario a esta URL: el chip de fuente de `traza_corrida`
 * aterrizaba en un 404. Esta página lo cerró con la MISMA fuente que ya pinta el Inicio, con filtro GET y total real. F7: el bloque
 * «Agentes que no corrieron y por qué» vive también aquí (es la otra mitad de la pregunta «qué pasó con las corridas»).
 */
export default async function IndiceCorridas({ searchParams }: { searchParams: Promise<SearchParams> }) {
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
  const flotas: OpcionFiltro[] | null = opciones.flotas === null ? null : [{ valor: '', rotulo: 'Todas las flotas' }, ...opciones.flotas.map((f) => ({ valor: f.id, rotulo: f.nombre }))];
  const params = { agente: agente || undefined, estado: estado || undefined, tenant: tenant || undefined };

  return (
    <MarcoPagina titulo="Corridas" apoyo="Las corridas de los agentes en todas las flotas, y qué agentes no corrieron y por qué. Cada corrida abre su traza completa.">
      <BarraFiltros accion="/admin/corridas" enLinea buscar etiqueta="Filtrar corridas" nActivos={[agente, estado, tenant].filter(Boolean).length} limpiarHref="/admin/corridas">
        <FiltroOpciones etiqueta="Agente" nombre="agente" valor={agente} opciones={OPCIONES_AGENTE} />
        <FiltroOpciones etiqueta="Estado" nombre="estado" valor={estado} opciones={[{ valor: '', rotulo: 'Cualquier estado' }, ...ESTADOS_CORRIDA.map((e) => ({ valor: e, rotulo: CHIP[e].etiqueta }))]} />
        {flotas ? <FiltroOpciones etiqueta="Flota" nombre="tenant" valor={tenant} opciones={flotas} /> : null}
      </BarraFiltros>

      {resultado === null ? (
        <EstadoError reintentar>No se pudieron leer las corridas. La consulta falló; no es que no existan.</EstadoError>
      ) : (
        <>
          <TablaLista<CorridaCruzada>
            etiqueta="Corridas de agentes" columnas={COLUMNAS} filas={resultado.corridas} idFila={(c) => c.id} base="/admin/corridas" params={params}
            vacio={hayFiltro
              ? { titulo: 'Ninguna corrida coincide', texto: 'Ninguna corrida coincide con el filtro. Quita un filtro o cambia el agente.' }
              : { titulo: 'Aún no hay corridas', texto: 'Cada corrida de un agente deja aquí su fila; la primera aparecerá cuando un agente trabaje.' }}
          />
          {resultado.total > 0 ? (
            <PiePaginas base="/admin/corridas" params={params} pagina={resultado.pagina} paginas={resultado.paginas} total={resultado.total} tamano={CORRIDAS_POR_PAGINA} unidad="corridas" />
          ) : null}
        </>
      )}

      <BloqueAgentesParados datos={parados} cola={cola} />
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Corridas' };
