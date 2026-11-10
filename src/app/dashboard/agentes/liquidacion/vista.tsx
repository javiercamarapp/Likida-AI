import Link from 'next/link';
import { ArrowRight, Bot, BellRing, Flag, Link2, Settings } from 'lucide-react';
import './liquidacion.css';
import type { LiqRow, DashboardKpis, HechoSolo, DineroObservadoTipo } from '@/lib/likida/analytics';
import { etiquetaConcepto, type PoliticaGasto } from '@/lib/likida/cuadre/engine';
import { mxn, mxnCompacto, numero, fechaCorta } from '@/lib/formato';
import { Bloque } from '../../bloque';
import { SeccionCola, type ColaProps } from './cola';

// El rótulo de cada tipo de diferencia vive en `rotulo-diferencia.ts`, tipado
// contra `TipoDiferencia` completo (M10) — aquí había 3 renglones para ~35 tipos.
import { rotuloDiferencia as rotuloTipo } from './rotulo-diferencia';
import { BarList, Columnas, Cifra, DonaMini, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { EsqCifrasV2, EsqTablaV2, EsqTarjetaV2, EstadoVacio, FilaTarjetas, Icono, MarcoPagina, StatusChip, Tarjeta, TablaBase, type TonoEstado } from '@/app/ui-v2/componentes';

/** Los conteos del ciclo. `porRevisar` sale de los KPIs; los otros tres, de
 *  `contarViajes`. Van juntos porque los pinta UNA sola tarjeta. */
export interface CicloLiquidacion {
  abiertos: number | null;
  enCuadre: number | null;
  porRevisar: number;
  liquidados: number | null;
}

/** Las cuatro fuentes de "Lo que hizo solo", en un solo paquete: la tarjeta
 *  aterriza completa y no a pedazos. */
export interface HizoSolo {
  hechos: HechoSolo[] | null;
  huerfanos: { resueltos: number; totales: number } | null;
  docsProcesados: number | null;
  /** Lecturas de IA del agente (sin chat). null = no se pudo leer. */
  actividadIa: number | null;
}

/**
 * FE-14: `extra` ya no es un paquete de VALORES sino de PROMESAS. La página
 * las lanza todas juntas y cada tarjeta espera SOLO la suya — pasar el valor
 * ya esperado volvería a serializar aquí lo que allá se paralelizó.
 */
export interface ExtraAgenteLiquidacion {
  /** ¿El rol puede abrir /dashboard/configuracion? (El contador no —
   *  esconder el link vale más que un clic que rebota.) No es una lectura:
   *  se resuelve con la sesión y viaja como valor. */
  puedeVerReglas: boolean;
  ciclo: Promise<CicloLiquidacion>;
  /** Cierres por día (últimas 12 semanas). null = no se pudo leer. */
  cierresPorDia: Promise<Array<{ fecha: string; valor: number }> | null>;
  hizoSolo: Promise<HizoSolo>;
  porTipo: Promise<DineroObservadoTipo[] | null>;
  /** Diferencias por operador, ya en forma de barras (top, solo >0). */
  operadores: Promise<Array<{ etiqueta: string; valor: number }> | null>;
  politica: Promise<PoliticaGasto[] | null>;
}

/**
 * El render del Agente de Liquidación de Ruta (v2, 13-ago-2026: "gráficas,
 * algo visual… estilo minimalista elegante premium como el dashboard
 * inicial"). Tres zonas: la firma del humano (cola), la evidencia de que el
 * agente trabaja (ciclo, calendario, lo-que-hizo-solo), y el criterio con el
 * que juzga (dinero observado, operadores, sus reglas).
 *
 * Cada sección degrada por su cuenta: un dato que no se pudo leer enseña su
 * leyenda honesta sin tumbar la página — y un cero MEDIDO sí se grafica. Y
 * desde FE-14 cada una además LLEGA por su cuenta: la barra de página sale
 * con el primer flush y las nueve tarjetas aterrizan conforme contestan sus
 * consultas, cada una con un esqueleto de su alto.
 */
export function VistaAgenteLiquidacion({
  kpis, liquidaciones, cola, extra, sufijo, notificaciones, externas,
}: {
  /** Primario: falla CERRADO. Su bloque enseña `EstadoError` — nunca un
   *  "0 por revisar" que nadie midió. */
  kpis: Promise<DashboardKpis>;
  /** Las 50 liquidaciones más recientes — SOLO para «últimos cierres».
   *  La cola YA NO sale de aquí (FE-5): un recorte de 2.4 h escondía justo a
   *  las que más llevaban esperando firma. */
  liquidaciones: Promise<LiqRow[]>;
  /** La cola de revisión de verdad: su propia consulta, por antigüedad, por
   *  llave y con `count` real. Ver `cola.tsx`. */
  cola: ColaProps;
  extra: ExtraAgenteLiquidacion;
  sufijo: string;
  /** La sección de Notificaciones, ya renderizada en el servidor
   *  (`SeccionNotificaciones`). Entra como ReactNode y no como datos: esta
   *  vista no debe importar el motor de avisos, que trae `supabaseAdmin`. */
  notificaciones?: React.ReactNode;
  /** «Liquidaciones externas» (0370): las que calculó el SAP/TMS de la flota y
   *  Likida solo entrega. Entra ya renderizada (con su `Bloque`) por la misma
   *  razón que `notificaciones`: la vista no importa el repositorio de datos. */
  externas?: React.ReactNode;
}) {
  return (
    <MarcoPagina titulo="Liquidación automática" apoyo="El agente arma la liquidación de cada viaje: lo que espera tu firma, lo que hizo solo y el criterio con el que juzga.">

      <Bloque mensaje="No se pudieron leer los indicadores del agente." esqueleto={<EsqCifrasV2 n={4} />}>
        <BloqueKpis kpis={kpis} />
      </Bloque>

      <Bloque mensaje="No se pudo leer la cola de revisión." esqueleto={<EsqTablaV2 filas={5} />}>
        <SeccionCola {...cola} />
      </Bloque>

      {externas}

      {/* ── La evidencia de que trabaja ── */}
      <FilaTarjetas variante="4-4-4">
        <Bloque mensaje="No se pudo contar el ciclo." esqueleto={<EsqTarjetaV2 alto={160} />}>
          <BloqueCiclo ciclo={extra.ciclo} />
        </Bloque>
        <Bloque mensaje="No se pudo leer la actividad." esqueleto={<EsqTarjetaV2 alto={160} />}>
          <BloqueCierres cierresPorDia={extra.cierresPorDia} />
        </Bloque>
        <Bloque mensaje="No se pudo leer el registro." esqueleto={<EsqTarjetaV2 alto={160} />}>
          <BloqueHizoSolo hizoSolo={extra.hizoSolo} />
        </Bloque>
      </FilaTarjetas>

      {/* ── El criterio con el que juzga ── */}
      <FilaTarjetas variante="4-4-4">
        <Bloque mensaje="No se pudo leer el desglose." esqueleto={<EsqTarjetaV2 alto={240} />}>
          <BloqueDineroObservado porTipo={extra.porTipo} />
        </Bloque>
        <Bloque mensaje="No se pudo leer el desglose por operador." esqueleto={<EsqTarjetaV2 alto={240} />}>
          <BloqueOperadores operadores={extra.operadores} />
        </Bloque>
        <Bloque mensaje="No se pudo leer la política." esqueleto={<EsqTarjetaV2 alto={240} />}>
          <BloqueReglas politica={extra.politica} puedeVerReglas={extra.puedeVerReglas} sufijo={sufijo} />
        </Bloque>
      </FilaTarjetas>

      <Bloque mensaje="No se pudieron leer los últimos cierres." esqueleto={<EsqTablaV2 filas={5} />}>
        <BloqueUltimosCierres liquidaciones={liquidaciones} sufijo={sufijo} />
      </Bloque>

      {notificaciones}
    </MarcoPagina>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LOS BLOQUES. Cada uno espera SOLO su promesa.
// ═══════════════════════════════════════════════════════════════════════════

async function BloqueKpis({ kpis: pKpis }: { kpis: Promise<DashboardKpis> }) {
  const kpis = await pKpis;
  return (
    <TiraCifras sello={selloHoy('Liquidaciones de la flota')}>
      {/* FE-17: es el acumulado HISTÓRICO — a escala 50k son miles de millones y
          `$9,000,000,000.00` no cabe en un cuarto de fila. `mxnCompacto`
          abrevia SOLO a partir del millón; debajo es `mxn()` exacto. */}
      <Cifra info="liquidacion.monto_comprobado" etiqueta="Monto comprobado" valor={mxnCompacto(kpis.montoComprobado)} nota="histórico" />
      <Cifra info="liquidacion.tasa_cuadre" etiqueta="Tasa de cuadre" valor={`${numero(kpis.tasaCuadre)}%`} nota={`${numero(kpis.viajesLiquidados)} liquidaciones`} />
      {/* BLOQ-6: desde la 0299 hay DOS estados y este KPI es el del MOTOR
          («no pude cuadrarla»), no el de la firma. La cola de abajo cuenta lo
          que espera FIRMA —que incluye las de diferencias— y sale de su
          propia consulta: dos números distintos con su rótulo distinto, en vez
          de dos versiones del mismo. */}
      <Cifra info="liquidacion.por_revisar" etiqueta="Por revisar" valor={numero(kpis.porRevisar)} nota="el agente no pudo cuadrarlas"
        tono={kpis.porRevisar > 0 ? 'warn' : undefined} />
      <Cifra info="liquidacion.con_diferencias" etiqueta="Con diferencias" valor={numero(kpis.conDiferencias)} tono={kpis.conDiferencias > 0 ? 'bad' : undefined} />
    </TiraCifras>
  );
}

async function BloqueCiclo({ ciclo }: { ciclo: Promise<CicloLiquidacion> }) {
  const funnel = await ciclo;
  // Barras SOLO de lo VIVO (auditoría 13-ago): "Liquidados" es acumulado
  // histórico y en meses domina la escala — las etapas vivas se volverían
  // astillas invisibles. Lo vivo se grafica; el histórico es una línea.
  const cicloVivoLegible = funnel.abiertos !== null && funnel.enCuadre !== null;
  const pasosVivos = cicloVivoLegible
    ? [
        { clave: 'abiertos', etiqueta: 'Abiertos', valor: funnel.abiertos as number },
        { clave: 'en_cuadre', etiqueta: 'En cuadre', valor: funnel.enCuadre as number },
        { clave: 'por_revisar', etiqueta: 'Por revisar', valor: funnel.porRevisar },
      ]
    : [];
  const hayCicloVivo = cicloVivoLegible && pasosVivos.some((p) => p.valor > 0);
  if (!cicloVivoLegible) {
    return <Tarjeta titulo="Viajes en curso" info="liquidacion.viajes_en_curso" estado="error" mensaje="No se pudo contar el ciclo ahora mismo. Queda pendiente; no es un cero." />;
  }
  if (!hayCicloVivo) {
    return (
      <Tarjeta titulo="Viajes en curso" info="liquidacion.viajes_en_curso" estado="vacio" mensaje="Nada vivo en el ciclo" detalle="El próximo viaje que despaches aparece aquí.">
        {null}
      </Tarjeta>
    );
  }
  return (
    <Tarjeta titulo="Viajes en curso" info="liquidacion.viajes_en_curso">
      <p className="rv-liq-sub">La foto de ahora mismo, por etapa</p>
      {/* BarList y no embudo A PROPÓSITO: el embudo imprime conversión paso a paso y este ciclo no es un embudo decreciente. */}
      <BarList etiqueta="Viajes en curso por etapa" items={pasosVivos} formato="numero" />
      {funnel.liquidados !== null && (
        <p className="rv-liq-pie">
          <strong className="cifra-mono">{numero(funnel.liquidados)}</strong> viajes liquidados en total, histórico.
        </p>
      )}
    </Tarjeta>
  );
}

async function BloqueCierres({ cierresPorDia }: {
  cierresPorDia: Promise<Array<{ fecha: string; valor: number }> | null>;
}) {
  const dias = await cierresPorDia;
  const total = dias?.reduce((s, d) => s + d.valor, 0) ?? 0;
  if (dias === null) {
    return <Tarjeta titulo="Cierres por día" info="liquidacion.cierres_por_dia" estado="error" mensaje="No se pudo leer la actividad ahora mismo." />;
  }
  if (total <= 0) {
    return (
      <Tarjeta titulo="Cierres por día" info="liquidacion.cierres_por_dia" estado="vacio" mensaje="Sin cierres en 12 semanas" detalle="Cada día con cierres pinta su columna.">
        {null}
      </Tarjeta>
    );
  }
  return (
    <Tarjeta titulo="Cierres por día" info="liquidacion.cierres_por_dia">
      <p className="rv-liq-sub">Últimas 12 semanas</p>
      <Columnas
        etiqueta="Liquidaciones cerradas por día, últimas 12 semanas"
        datos={dias.map((d) => ({ etiqueta: fechaCorta(d.fecha), valor: d.valor, largo: fechaCorta(d.fecha) }))}
        formato="numero"
        alto={140}
        variacion={false}
        unidad="liquidaciones"
      />
      <p className="rv-liq-pie">{numero(total)} liquidaciones cerradas en la ventana.</p>
    </Tarjeta>
  );
}

async function BloqueHizoSolo({ hizoSolo }: { hizoSolo: Promise<HizoSolo> }) {
  const { hechos, huerfanos, docsProcesados, actividadIa } = await hizoSolo;
  if (hechos === null) {
    return <Tarjeta titulo="Lo que hizo solo" info="liquidacion.hizo_solo" estado="error" mensaje="No se pudo leer el registro ahora mismo." />;
  }
  if (hechos.length === 0 && !(huerfanos && huerfanos.resueltos > 0)) {
    return (
      <Tarjeta titulo="Lo que hizo solo" info="liquidacion.hizo_solo" estado="vacio" mensaje="Aún nada que presumir"
        detalle="Cuando el agente mande un recordatorio o escale un viaje sin que nadie se lo pida, queda escrito aquí.">
        {null}
      </Tarjeta>
    );
  }
  return (
    <Tarjeta titulo="Lo que hizo solo" info="liquidacion.hizo_solo">
      <ul className="rv-liq-hechos">
        {hechos.map((h, i) => (
          <li key={i} className="rv-liq-hecho">
            <span className="rv-liq-hecho__icono" data-tono={h.tipo === 'recordatorio' ? 'neutro' : 'warn'}>
              <Icono icono={h.tipo === 'recordatorio' ? BellRing : Flag} />
            </span>
            <div className="rv-liq-hecho__texto">
              {h.tipo === 'recordatorio'
                ? <span>Le recordó a <strong>{h.operador ?? 'el operador'}</strong> comprobar el viaje {h.folio}</span>
                : <span>Escaló el viaje <strong>{h.folio}</strong> para atención humana</span>}
              <span className="rv-liq-hecho__fecha">{fechaCorta(h.cuando)}</span>
            </div>
          </li>
        ))}
        {huerfanos && huerfanos.resueltos > 0 && (
          <li className="rv-liq-hecho rv-liq-hecho--aparte">
            <span className="rv-liq-hecho__icono" data-tono="ok"><Icono icono={Link2} /></span>
            <span className="rv-liq-hecho__texto">Amarró solo <strong>{numero(huerfanos.resueltos)}</strong> comprobantes que llegaron sin viaje asignado.</span>
          </li>
        )}
      </ul>
      {(docsProcesados !== null || actividadIa !== null) && (
        <p className="rv-liq-pie">
          {docsProcesados !== null && (
            <><strong className="cifra-mono">{numero(docsProcesados)}</strong> comprobantes leídos</>
          )}
          {docsProcesados !== null && actividadIa !== null && ' · '}
          {actividadIa !== null && (
            <><strong className="cifra-mono">{numero(actividadIa)}</strong> lecturas de IA</>
          )}
          {' '}— histórico.
        </p>
      )}
    </Tarjeta>
  );
}

export async function BloqueDineroObservado({ porTipo: p }: { porTipo: Promise<DineroObservadoTipo[] | null> }) {
  const porTipo = await p;
  const totalObservado = porTipo?.reduce((s, t) => s + t.monto, 0) ?? 0;
  if (porTipo === null) {
    return <Tarjeta titulo="Dinero observado" info="liquidacion.dinero_observado" estado="error" mensaje="No se pudo leer el desglose ahora mismo." />;
  }
  if (porTipo.length === 0) {
    return (
      <Tarjeta titulo="Dinero observado" info="liquidacion.dinero_observado" estado="vacio" mensaje="Sin diferencias detectadas"
        detalle="Cuando el agente atrape un gasto fuera de política o un ticket duplicado, aquí se desglosa.">
        {null}
      </Tarjeta>
    );
  }
  return (
    <Tarjeta titulo="Dinero observado" info="liquidacion.dinero_observado">
      <p className="rv-liq-sub">Todas las diferencias que el motor registró, por tipo — histórico completo, no solo fuera de política o duplicado</p>
      <DonaMini
        etiqueta="Dinero observado por tipo de diferencia"
        centro={mxn(totalObservado)}
        formato="mxn"
        gajos={porTipo.map((t) => ({ etiqueta: rotuloTipo(t.tipo), valor: t.monto }))}
      />
      <ul className="rv-liq-filas">
        {porTipo.map((t) => (
          <li key={t.tipo} className="rv-liq-filas__fila">
            <span className="rv-liq-filas__rotulo">{rotuloTipo(t.tipo)} · {numero(t.n)}</span>
            <span className="cifra-mono">{mxn(t.monto)}</span>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

async function BloqueOperadores({ operadores: p }: {
  operadores: Promise<Array<{ etiqueta: string; valor: number }> | null>;
}) {
  const operadores = await p;
  if (operadores === null) {
    return <Tarjeta titulo="Diferencias por operador" info="liquidacion.por_operador" estado="error" mensaje="No se pudo leer el desglose ahora mismo." />;
  }
  if (operadores.length === 0) {
    return (
      <Tarjeta titulo="Diferencias por operador" info="liquidacion.por_operador" estado="vacio" mensaje="Ningún operador acumula diferencias" detalle="La señal que quieres ver.">
        {null}
      </Tarjeta>
    );
  }
  return (
    <Tarjeta titulo="Diferencias por operador" info="liquidacion.por_operador">
      <p className="rv-liq-sub">Liquidaciones con diferencia, por operador</p>
      <BarList etiqueta="Liquidaciones con diferencia por operador" formato="numero" items={operadores.map((o, i) => ({ clave: `${i}-${o.etiqueta}`, etiqueta: o.etiqueta, valor: o.valor }))} />
    </Tarjeta>
  );
}

async function BloqueReglas({ politica: p, puedeVerReglas, sufijo }: {
  politica: Promise<PoliticaGasto[] | null>; puedeVerReglas: boolean; sufijo: string;
}) {
  const politica = await p;
  /* "Ver", no "Editar": Configuración hoy es solo lectura — un botón que promete editar y no edita es un botón que miente.
     Cuando esa página edite, esto vuelve a ser "Editar". */
  const ver = puedeVerReglas ? (
    <Link href={`/dashboard/configuracion${sufijo}`} title="Ver la configuración completa" className="rv-liq-enlace">
      <Icono icono={Settings} tam={14} /> Ver
    </Link>
  ) : null;
  if (politica === null) {
    return <Tarjeta titulo="Sus reglas" info="liquidacion.reglas" acciones={ver} estado="error" mensaje="No se pudo leer la política ahora mismo." />;
  }
  return (
    <Tarjeta titulo="Sus reglas" info="liquidacion.reglas" acciones={ver}>
      <ul className="rv-liq-filas">
        {politica.map((pg) => (
          <li key={pg.concepto} className="rv-liq-filas__fila">
            <span className="rv-liq-filas__rotulo">{etiquetaConcepto(pg.concepto)}</span>
            <span className="cifra-mono">
              {pg.topeMonto !== undefined ? mxn(pg.topeMonto) : pg.requiereCfdi ? 'Requiere CFDI' : 'Sin tope'}
            </span>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

async function BloqueUltimosCierres({ liquidaciones, sufijo }: {
  liquidaciones: Promise<LiqRow[]>; sufijo: string;
}) {
  const liqs = await liquidaciones;
  const cierres = liqs.filter((l) => l.estatus !== 'revisar').slice(0, 5);
  return (
    <Tarjeta titulo="Últimos cierres" info="liquidacion.ultimos_cierres">
      {cierres.length === 0 ? (
        <EstadoVacio icono={Bot} titulo="Aún sin cierres">
          El agente todavía no cierra ninguna liquidación en esta flota.
        </EstadoVacio>
      ) : (
        <TablaLiqs filas={cierres} sufijo={sufijo} conVer />
      )}
    </Tarjeta>
  );
}

const ESTATUS: Record<string, { rotulo: string; tono: TonoEstado }> = {
  cuadrada: { rotulo: 'Cuadrada', tono: 'ok' },
  con_diferencias: { rotulo: 'Con diferencias', tono: 'warn' },
  revisar: { rotulo: 'Por revisar', tono: 'bad' },
};

function TablaLiqs({ filas, sufijo, conVer }: { filas: LiqRow[]; sufijo: string; conVer?: boolean }) {
  return (
    <TablaBase<LiqRow>
      etiqueta="Viajes de la liquidación"
      filas={filas}
      idFila={(l) => l.id}
      tarjetaMovil
      columnas={[
        { id: 'viaje', titulo: 'Viaje', principal: true, celda: (l) => <strong>{l.folio}</strong> },
        { id: 'fecha', titulo: 'Fecha', celda: (l) => <span className="rv-liq-apagado">{fechaCorta(l.creadoEn)}</span> },
        { id: 'comprobado', titulo: 'Comprobado', alinear: 'der', celda: (l) => <span className="cifra-mono">{mxn(l.comprobado)}</span> },
        { id: 'diferencia', titulo: 'Diferencia', alinear: 'der', celda: (l) => <span className={l.diferencia !== 0 ? 'cifra-mono rv-liq-malo' : 'cifra-mono'}>{mxn(l.diferencia)}</span> },
        {
          id: 'estatus', titulo: 'Estatus', celda: (l) => {
            const e = ESTATUS[l.estatus] ?? { rotulo: l.estatus, tono: 'muted' as const };
            return <StatusChip tono={e.tono}>{e.rotulo}</StatusChip>;
          },
        },
        ...(conVer ? [{
          id: 'ver', titulo: 'Ver el viaje', alinear: 'der' as const, celda: (l: LiqRow) => (
            <Link href={`/dashboard/${l.id}${sufijo}`} className="rv-liq-enlace">Ver <Icono icono={ArrowRight} tam={14} /></Link>
          ),
        }] : []),
      ]}
    />
  );
}
