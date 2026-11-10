import { Download } from 'lucide-react';
import '../conductores.css';
import { fechaMx, numero } from '@/lib/formato';
import { horaExactaMx, type FilaEstadia, type ResumenEstadias } from '@/lib/likida/conductor/estadias_anden';
import { textoTiempo } from '@/lib/likida/conductor/planificador';
import type { CatalogosFiltro } from '@/lib/likida/conductor/repo_validacion';
import { Aviso, BarraPeriodo, BotonEnlace, clasesBoton, EstadoError, hrefConParams, Icono, MarcoPagina, StatusChip, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import { BarList, Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ESTADÍAS EN ANDÉN (0385) — cuánto tiempo estuvo cada unidad en cada parada. CERO pesos en
// pantalla (área `operacion`): el renglón de cobro con horas libres y tarifa vive en el CSV de
// /v1/estadias, que ven el dueño y el contador.
// ═══════════════════════════════════════════════════════════════════════════

export interface FiltrosEstadias { desde: string; hasta: string; terminalId: string; clienteId: string; operadorId: string }

const FASE: Record<string, string> = {
  cerrada: 'Cerrada', en_curso: 'En curso (sigue en el andén)', sin_salida: 'Sin salida registrada', incoherente: 'Horas incoherentes', sin_llegada: 'Sin llegada registrada',
};
const FUENTE = { chofer: 'mensaje del chofer', oficina: 'captura de oficina', sistema: 'sistema' } as const;
const VALIDACION = { validado: 'validada con ubicación', sin_coincidencia: 'ubicación sin coincidencia', sin_dato: 'sin dato de ubicación' } as const;

const minutos = (m: number | null): string => (m === null ? '—' : m < 60 ? `${numero(m)} min` : textoTiempo(m));

/** Promedio de minutos de las paradas CERRADAS de un lugar, o null si no hay. Honesto: «sobre N paradas cerradas». */
export function promedioCerradas(filas: readonly FilaEstadia[], lugar: 'carga' | 'descarga'): { promedio: number; n: number } | null {
  const xs = filas.filter((f) => f.estancia.lugar === lugar && f.estancia.fase === 'cerrada' && f.estancia.minutos !== null).map((f) => f.estancia.minutos as number);
  return xs.length === 0 ? null : { promedio: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), n: xs.length };
}

export function VistaEstadias({ sufijo, filtros, catalogos, filas, resumen, truncada, error, csvUrl, ocultos, zonaHoraria }: {
  /** Zona de la flota para las horas exactas (México por omisión). */
  zonaHoraria?: string;
  sufijo: string; filtros: FiltrosEstadias; catalogos: CatalogosFiltro | null;
  filas: FilaEstadia[]; resumen: ResumenEstadias; truncada: boolean; error: string | null;
  /** Solo si el rol ve dinero: el CSV de cobro (con horas libres, tarifa y monto propuesto). */
  csvUrl: string | null; ocultos: Record<string, string>;
}) {
  const RUTA = '/dashboard/agentes/conductores/estadias';
  const todos = { valor: '', rotulo: 'Todos' };
  const criterios = [
    { nombre: 'terminal', etiqueta: 'Patio', valor: filtros.terminalId, opciones: [todos, ...(catalogos?.terminales ?? []).map((t) => ({ valor: t.id, rotulo: t.nombre }))] },
    { nombre: 'cliente', etiqueta: 'Cliente', valor: filtros.clienteId, opciones: [todos, ...(catalogos?.clientes ?? []).map((c) => ({ valor: c.id, rotulo: c.nombre }))] },
    { nombre: 'chofer', etiqueta: 'Chofer', valor: filtros.operadorId, opciones: [todos, ...(catalogos?.operadores ?? []).map((o) => ({ valor: o.id, rotulo: o.nombre }))] },
  ];
  // Parámetros vigentes (contexto + periodo + criterios) para armar el enlace de cada «x».
  const base: Record<string, string> = { ...ocultos, desde: filtros.desde, hasta: filtros.hasta };
  for (const c of criterios) if (c.valor) base[c.nombre] = c.valor;
  const hrefLimpio = `?${new URLSearchParams(ocultos).toString()}`;
  const carga = promedioCerradas(filas, 'carga');
  const descarga = promedioCerradas(filas, 'descarga');
  const COLUMNAS: readonly ColumnaBase<FilaEstadia>[] = [
    { id: 'viaje', titulo: 'Viaje', principal: true, celda: (f) => <><span className="rv-cd__medio">{f.viaje.folio ?? 'sin folio'}</span><span className="rv-cd__micro rv-cd__bloquear">{f.viaje.clienteNombre ?? ''}</span></> },
    { id: 'chofer', titulo: 'Chofer', celda: (f) => <>{f.viaje.operadorNombre ?? '—'}<span className="rv-cd__micro rv-cd__bloquear">{f.viaje.terminalNombre ?? ''}</span></> },
    { id: 'parada', titulo: 'Parada', celda: (f) => <>{f.estancia.lugar === 'carga' ? 'Carga' : 'Descarga'}<span className="rv-cd__micro rv-cd__bloquear">{f.sitio ?? ''}</span></> },
    { id: 'llegada', titulo: 'Llegada (hora del mensaje)', celda: (f) => <><span className="cifra-mono">{horaExactaMx(f.estancia.llegada?.en ?? null, zonaHoraria) || '—'}</span><span className="rv-cd__micro rv-cd__bloquear">{f.estancia.llegada ? FUENTE[f.estancia.llegada.fuente] : ''}</span></> },
    { id: 'salida', titulo: 'Salida', celda: (f) => <><span className="cifra-mono">{horaExactaMx(f.estancia.salida?.en ?? null, zonaHoraria) || '—'}</span><span className="rv-cd__micro rv-cd__bloquear">{f.estancia.salida ? FUENTE[f.estancia.salida.fuente] : ''}</span></> },
    { id: 'tiempo', titulo: 'Tiempo', alinear: 'der', celda: (f) => <span className="cifra-mono">{minutos(f.estancia.minutos)}</span> },
    { id: 'estado', titulo: 'Estado', celda: (f) => <StatusChip tono={f.estancia.fase === 'cerrada' ? 'ok' : f.estancia.fase === 'en_curso' ? 'warn' : 'muted'}>{FASE[f.estancia.fase]}</StatusChip> },
    {
      id: 'respaldo', titulo: 'Respaldo',
      celda: (f) => (
        <span className="rv-cd__micro" data-tono="muted">
          {f.estancia.llegada ? (f.estancia.llegada.validacion ? VALIDACION[f.estancia.llegada.validacion] : 'sin veredicto') : '—'}
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
  return (
    <MarcoPagina titulo="Estadías en andén" apoyo="El tiempo entre la llegada y la salida de cada carga y descarga, con la hora exacta del mensaje del chofer." acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/conductores${sufijo}`}>Volver al tablero</BotonEnlace>}>
      <Aviso tono="info">
        La hora es la <strong>hora exacta del mensaje del chofer</strong> (no telemetría del evento físico). Cada fila dice de dónde salió la hora, si la ubicación la validó y cuántas fotos la respaldan.
      </Aviso>

      <Tarjeta titulo="Periodo y filtros">
        <div className="rv-cd__pila">
          <BarraPeriodo etiqueta="Periodo y filtros de estadías"
            chips={[
              { id: 'rango', etiqueta: `Del ${fechaMx(filtros.desde)} al ${fechaMx(filtros.hasta)}` },
              ...criterios.filter((c) => c.valor).map((c) => ({ id: c.nombre, etiqueta: `${c.etiqueta}: ${c.opciones.find((o) => o.valor === c.valor)?.rotulo ?? 'elegido'}`, hrefQuitar: hrefConParams(RUTA, base, { [c.nombre]: null }) })),
            ]}
            cajon={{
              accion: RUTA, ocultos: Object.entries(ocultos), limpiarHref: hrefLimpio, nActivos: criterios.filter((c) => c.valor).length,
              resumen: `Del ${fechaMx(filtros.desde)} al ${fechaMx(filtros.hasta)}`,
              periodo: { desde: filtros.desde, hasta: filtros.hasta },
              campos: { items: criterios.map((c) => ({ tipo: 'select' as const, ...c })) },
            }}
            accion={csvUrl ? (
              <a href={csvUrl} className={clasesBoton('primary', 'sm')}>
                <Icono icono={Download} tam={14} />CSV para cobro de estadías
              </a>
            ) : undefined} />
          {!csvUrl && (
            <p className="rv-cd__micro">El CSV de cobro (horas libres, tarifa y monto propuesto) lo descargan el dueño de la flota y el contador.</p>
          )}
          <p className="rv-cd__micro">Periodo por la hora del aviso de LLEGADA, en días de México, ambos inclusive.</p>
        </div>
      </Tarjeta>

      {error ? (
        <EstadoError compacto>{error}</EstadoError>
      ) : (
        <>
          <TiraCifras sello={selloHoy('Estadías en andén')}>
            <Cifra etiqueta="Paradas del periodo" info="conductores_estadias.paradas" valor={numero(resumen.paradas)} nota={`${numero(resumen.cerradas)} cerradas · ${numero(resumen.enCurso)} en curso`} />
            <Cifra etiqueta="Tiempo medio en carga" info="conductores_estadias.medio_carga" valor={carga ? minutos(carga.promedio) : null} nota={carga ? `sobre ${numero(carga.n)} paradas cerradas` : 'ninguna carga cerrada'} />
            <Cifra etiqueta="Tiempo medio en descarga" info="conductores_estadias.medio_descarga" valor={descarga ? minutos(descarga.promedio) : null} nota={descarga ? `sobre ${numero(descarga.n)} paradas cerradas` : 'ninguna descarga cerrada'} />
            <Cifra etiqueta="En el andén ahora" info="conductores_estadias.en_anden" valor={numero(resumen.enCurso)} tono={resumen.enCurso > 0 ? 'warn' : undefined} nota="llegaron y aún no avisan su salida" />
          </TiraCifras>
          {truncada && (
            <p className="rv-cd__nota" data-tono="warn">
              Hay más viajes con llegada en este periodo de los que una lectura trae: acorta el periodo o filtra por patio, cliente o chofer. Lo que ves NO es el total.
            </p>
          )}
          {porCliente.length > 0 && (
            <Tarjeta titulo="Tiempo medio por cliente (paradas cerradas)">
              <BarList etiqueta="Minutos medios de estadía por cliente" formato={minutos}
                items={porCliente.map((c) => ({ clave: c.nombre, etiqueta: c.nombre, valor: c.promedio, texto: minutos(c.promedio), nota: `sobre ${numero(c.n)} paradas cerradas` }))} />
            </Tarjeta>
          )}
          <Tarjeta titulo="Paradas" estado={filas.length === 0 ? 'vacio' : 'ok'} mensaje="Sin paradas en el periodo"
            detalle="Ninguna parada con llegada registrada en ese periodo y con esos filtros.">
            <TablaBase etiqueta="Estadías por viaje y chofer" columnas={COLUMNAS} filas={filas} idFila={(f) => `${f.viaje.id}-${f.estancia.lugar}`} densa tarjetaMovil />
          </Tarjeta>
        </>
      )}
    </MarcoPagina>
  );
}
