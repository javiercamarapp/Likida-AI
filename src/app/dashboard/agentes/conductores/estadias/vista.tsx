import { Download } from 'lucide-react';
import '../conductores.css';
import { fechaMx, numero } from '@/lib/formato';
import { horaExactaMx, type FilaEstadia, type ResumenEstadias } from '@/lib/likida/conductor/estadias_anden';
import { textoTiempo } from '@/lib/likida/conductor/planificador';
import type { CatalogosFiltro } from '@/lib/likida/conductor/repo_validacion';
import { Aviso, BarraPeriodo, BotonEnlace, clasesBoton, EstadoError, hrefConParams, Icono, StatusChip, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { BarList } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { conFilete } from '../../cifras-filete';
import { TablaVacia } from '../../vacio-agente';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ESTADÍAS EN ANDÉN (0385) — cuánto tiempo estuvo cada unidad en cada parada. CERO pesos en
// pantalla (área `operacion`): el renglón de cobro con horas libres y tarifa vive en el CSV de
// /v1/estadias, que ven el dueño y el contador.
// ═══════════════════════════════════════════════════════════════════════════

export interface FiltrosEstadias { desde: string; hasta: string; terminalId: string; clienteId: string; operadorId: string }

const faseTr = (tx: TAgentes = TR_ES.t): Record<string, string> => ({
  cerrada: tx('rest.cerrada'), en_curso: tx('rest.en_curso_sigue_en_el_anden'), sin_salida: tx('rest.sin_salida_registrada'), incoherente: tx('rest.horas_incoherentes'), sin_llegada: tx('rest.sin_llegada_registrada'),
});
const FUENTE = { chofer: 'mensaje del chofer', oficina: 'captura de oficina', sistema: 'sistema' } as const;
const validacionTr = (tx: TAgentes = TR_ES.t) => ({ validado: tx('rest.validada_con_ubicacion'), sin_coincidencia: tx('rest.ubicacion_sin_coincidencia'), sin_dato: tx('rest.sin_dato_de_ubicacion') } as const);

const minutos = (m: number | null): string => (m === null ? '—' : m < 60 ? `${numero(m)} min` : textoTiempo(m));

/** Promedio de minutos de las paradas CERRADAS de un lugar, o null si no hay. Honesto: «sobre N paradas cerradas». */
export function promedioCerradas(filas: readonly FilaEstadia[], lugar: 'carga' | 'descarga'): { promedio: number; n: number } | null {
  const xs = filas.filter((f) => f.estancia.lugar === lugar && f.estancia.fase === 'cerrada' && f.estancia.minutos !== null).map((f) => f.estancia.minutos as number);
  return xs.length === 0 ? null : { promedio: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), n: xs.length };
}

export function VistaEstadias({ sufijo, filtros, catalogos, filas, resumen, truncada, error, csvUrl, ocultos, zonaHoraria, tr = TR_ES }: {
  /** Zona de la flota para las horas exactas (México por omisión). */
  zonaHoraria?: string;
  sufijo: string; filtros: FiltrosEstadias; catalogos: CatalogosFiltro | null;
  filas: FilaEstadia[]; resumen: ResumenEstadias; truncada: boolean; error: string | null;
  /** Solo si el rol ve dinero: el CSV de cobro (con horas libres, tarifa y monto propuesto). */
  csvUrl: string | null; ocultos: Record<string, string>; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const RUTA = '/dashboard/agentes/conductores/estadias';
  const todos = { valor: '', rotulo: tx('rest.todos') };
  const criterios = [
    { nombre: 'terminal', etiqueta: tx('rest.patio'), valor: filtros.terminalId, opciones: [todos, ...(catalogos?.terminales ?? []).map((t) => ({ valor: t.id, rotulo: t.nombre }))] },
    { nombre: 'cliente', etiqueta: tx('vigia.vista.cliente'), valor: filtros.clienteId, opciones: [todos, ...(catalogos?.clientes ?? []).map((c) => ({ valor: c.id, rotulo: c.nombre }))] },
    { nombre: 'chofer', etiqueta: tx('cobranza.gasto.chofer'), valor: filtros.operadorId, opciones: [todos, ...(catalogos?.operadores ?? []).map((o) => ({ valor: o.id, rotulo: o.nombre }))] },
  ];
  // Parámetros vigentes (contexto + periodo + criterios) para armar el enlace de cada «x».
  const base: Record<string, string> = { ...ocultos, desde: filtros.desde, hasta: filtros.hasta };
  for (const c of criterios) if (c.valor) base[c.nombre] = c.valor;
  const hrefLimpio = `?${new URLSearchParams(ocultos).toString()}`;
  const carga = promedioCerradas(filas, 'carga');
  const descarga = promedioCerradas(filas, 'descarga');
  const COLUMNAS: readonly ColumnaBase<FilaEstadia>[] = [
    { id: 'viaje', titulo: tx('liquidacion.vista.viaje'), principal: true, celda: (f) => <><span className="rv-cd__medio">{f.viaje.folio ?? tx('cobranza.vista.sin_folio_2')}</span><span className="rv-cd__micro rv-cd__bloquear">{f.viaje.clienteNombre ?? ''}</span></> },
    { id: 'chofer', titulo: tx('cobranza.gasto.chofer'), celda: (f) => <>{f.viaje.operadorNombre ?? '—'}<span className="rv-cd__micro rv-cd__bloquear">{f.viaje.terminalNombre ?? ''}</span></> },
    { id: 'parada', titulo: tx('rest.parada'), celda: (f) => <>{f.estancia.lugar === 'carga' ? tx('rest.carga') : tx('rest.descarga')}<span className="rv-cd__micro rv-cd__bloquear">{f.sitio ?? ''}</span></> },
    { id: 'llegada', titulo: tx('rest.llegada_hora_del_mensaje'), celda: (f) => <><span className="rv-ag-num">{horaExactaMx(f.estancia.llegada?.en ?? null, zonaHoraria) || '—'}</span><span className="rv-cd__micro rv-cd__bloquear">{f.estancia.llegada ? FUENTE[f.estancia.llegada.fuente] : ''}</span></> },
    { id: 'salida', titulo: tx('rest.salida'), celda: (f) => <><span className="rv-ag-num">{horaExactaMx(f.estancia.salida?.en ?? null, zonaHoraria) || '—'}</span><span className="rv-cd__micro rv-cd__bloquear">{f.estancia.salida ? FUENTE[f.estancia.salida.fuente] : ''}</span></> },
    { id: 'tiempo', titulo: tx('rest.tiempo'), alinear: 'der', celda: (f) => <span className="rv-ag-num">{minutos(f.estancia.minutos)}</span> },
    { id: 'estado', titulo: tx('proveedores.vista.estado'), celda: (f) => <StatusChip tono={f.estancia.fase === 'cerrada' ? 'ok' : f.estancia.fase === 'en_curso' ? 'warn' : 'muted'}>{faseTr(tx)[f.estancia.fase]}</StatusChip> },
    {
      id: 'respaldo', titulo: tx('rest.respaldo'),
      celda: (f) => (
        <span className="rv-cd__micro" data-tono="muted">
          {f.estancia.llegada ? (f.estancia.llegada.validacion ? validacionTr(tx)[f.estancia.llegada.validacion] : tx('rest.sin_veredicto')) : '—'}
          <span className="rv-cd__bloquear">{(f.estancia.llegada?.evidencias ?? 0) + (f.estancia.salida?.evidencias ?? 0)} foto(s)</span>
        </span>
      ),
    },
  ];
  // Tiempo medio por cliente, solo de paradas CERRADAS con minutos medidos (nunca un cero por falta de dato).
  const acumulado = new Map<string, number[]>();
  for (const f of filas) {
    if (f.estancia.fase !== 'cerrada' || f.estancia.minutos === null) continue;
    const k = f.viaje.clienteNombre ?? 'Sin cliente';
    acumulado.set(k, [...(acumulado.get(k) ?? []), f.estancia.minutos]);
  }
  const porCliente = [...acumulado.entries()]
    .map(([nombre, xs]) => ({ nombre, n: xs.length, promedio: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) }))
    .sort((x, y) => y.promedio - x.promedio).slice(0, 8);
  const filtrosBarra = (
    <BarraPeriodo etiqueta={tx('rest.periodo_y_filtros_de_estadias')}
      chips={[
        { id: 'rango', etiqueta: tx('rest.del_al', { fechaMx: fechaMx(filtros.desde), fechaMx2: fechaMx(filtros.hasta) }) },
        ...criterios.filter((c) => c.valor).map((c) => ({ id: c.nombre, etiqueta: `${c.etiqueta}: ${c.opciones.find((o) => o.valor === c.valor)?.rotulo ?? 'elegido'}`, hrefQuitar: hrefConParams(RUTA, base, { [c.nombre]: null }) })),
      ]}
      cajon={{
        accion: RUTA, ocultos: Object.entries(ocultos), limpiarHref: hrefLimpio, nActivos: criterios.filter((c) => c.valor).length,
        resumen: tx('rest.del_al', { fechaMx: fechaMx(filtros.desde), fechaMx2: fechaMx(filtros.hasta) }),
        periodo: { desde: filtros.desde, hasta: filtros.hasta },
        campos: { items: criterios.map((c) => ({ tipo: 'select' as const, ...c })) },
      }}
      accion={csvUrl ? (
        <a href={csvUrl} className={clasesBoton('secondary', 'sm')}>
          <Icono icono={Download} tam={14} />{tx('rest.csv_para_cobro_de_estadias')}</a>
      ) : undefined} />
  );
  // Rovaq «Auditoría»: cabecera → filtros → avisos (≤2) → tira de cifras → tabla maestra con su pie declarado.
  return (
    <EsqueletoTablaMaestra
      titulo={tx('rest.estadias_en_anden')}
      apoyo={tx('rest.el_tiempo_entre_la_llegada_y')}
      acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/conductores${sufijo}`}>{tx('rest.volver_al_tablero')}</BotonEnlace>}
      filtros={filtrosBarra}
      avisos={(
        <>
          <Aviso tono="info">{ricoT(tx('rest.la_hora_es_la_strong_hora'), { strong: (c) => <strong>{c}</strong> })}</Aviso>
          {!error && truncada ? <Aviso tono="warn">{tx('rest.hay_mas_viajes_con_llegada_en')}</Aviso> : null}
        </>
      )}
      cifras={error ? undefined : conFilete([
        { etiqueta: tx('rest.paradas_del_periodo'), info: 'conductores_estadias.paradas', valor: numero(resumen.paradas), nota: `${numero(resumen.cerradas)} cerradas · ${numero(resumen.enCurso)} en curso` },
        { etiqueta: tx('rest.tiempo_medio_en_carga'), info: 'conductores_estadias.medio_carga', valor: carga ? minutos(carga.promedio) : null, nota: carga ? `sobre ${numero(carga.n)} paradas cerradas` : tx('rest.ninguna_carga_cerrada') },
        { etiqueta: tx('rest.tiempo_medio_en_descarga'), info: 'conductores_estadias.medio_descarga', valor: descarga ? minutos(descarga.promedio) : null, nota: descarga ? `sobre ${numero(descarga.n)} paradas cerradas` : tx('rest.ninguna_descarga_cerrada') },
        { etiqueta: tx('rest.en_el_anden_ahora'), info: 'conductores_estadias.en_anden', valor: numero(resumen.enCurso), tono: resumen.enCurso > 0 ? 'warn' : undefined, nota: tx('rest.llegaron_y_aun_no_avisan_su') },
      ])}
      etiquetaCifras={tx('rest.estadias_en_anden')}
      selloCifras={selloHoy(tx('rest.estadias_en_anden'))}
      agrupacion={!error && porCliente.length > 0 ? (
        <Tarjeta titulo={tx('rest.tiempo_medio_por_cliente_paradas_cerradas')}>
          <BarList etiqueta={tx('rest.minutos_medios_de_estadia_por_cliente')} formato={minutos}
            items={porCliente.map((c) => ({ clave: c.nombre, etiqueta: c.nombre, valor: c.promedio, texto: minutos(c.promedio), nota: `sobre ${numero(c.n)} paradas cerradas` }))} />
        </Tarjeta>
      ) : undefined}
      pie={(
        <>
          {tx('rest.periodo_por_la_hora_del_aviso')}
          {!csvUrl ? <> {tx('rest.el_csv_de_cobro_horas_libres')}</> : null}
        </>
      )}
    >
      {error ? (
        <EstadoError compacto>{error}</EstadoError>
      ) : (
        <Tarjeta titulo={tx('rest.paradas')}>
          {filas.length === 0 ? (
            <TablaVacia etiqueta={tx('rest.estadias_por_viaje_y_chofer')} titulos={COLUMNAS.filter((c) => !c.tituloOculto).map((c) => c.titulo)} titulo={tx('rest.sin_paradas_en_el_periodo')}>{tx('rest.ninguna_parada_con_llegada_registrada_en')}</TablaVacia>
          ) : (
            <TablaBase etiqueta={tx('rest.estadias_por_viaje_y_chofer')} columnas={COLUMNAS} filas={filas} idFila={(f) => `${f.viaje.id}-${f.estancia.lugar}`} densa tarjetaMovil />
          )}
        </Tarjeta>
      )}
    </EsqueletoTablaMaestra>
  );
}
