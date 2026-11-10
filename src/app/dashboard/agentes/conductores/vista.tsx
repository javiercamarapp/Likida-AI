import Link from 'next/link';
import { Send, CheckCheck, Flag, MapPin, Package, Truck, Sparkles, Ban } from 'lucide-react';
import type { EventoConductor } from '@/lib/likida/analytics';
import { HORAS_PARA_ESCALAR } from '@/lib/likida/escalar_viaje';
import { numero, fechaCorta } from '@/lib/formato';
import './conductores.css';
import { Bloque } from '../../bloque';
import { esFolioSimulado } from '@/lib/likida/conductor/tablero';
import { EtiquetaSimulado } from './tablero-hitos';
import { MENSAJE_SIN_LINEA_BASE, type Cifra as CifraDato, type InsightsConductor, type KpiPiloto } from '@/lib/likida/conductor/insights';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { Disclosure, EsqCifrasV2, EstadoError, EstadoVacio, EsqTablaV2, FilaTarjetas, Icono, MarcoPagina, StatusChip, Tarjeta, type TonoEstado } from '@/app/ui-v2/componentes';
import { fuenteLegible } from '@/app/dashboard/lenguaje-cliente';

export interface EsperaAceptar {
  id: string;
  folio: string;
  operadorNombre: string | null;
  /** Horas COMPLETAS desde el aviso — medidas, se rotulan así. */
  horasDesdeAviso: number;
  avisos: number;
}

/** Cómo se lee cada sello en la bitácora. Un tipo nuevo cae al crudo. */
const EVENTO: Record<EventoConductor['tipo'], { Icono: typeof Send; texto: (e: EventoConductor) => string; tono: 'ok' | 'bad' | 'warn' | 'muted' }> = {
  avisado: { Icono: Send, tono: 'muted', texto: (e) => `Le avisó a ${e.operador ?? 'el operador'} de su viaje ${e.folio}` },
  acepto: { Icono: CheckCheck, tono: 'ok', texto: (e) => `${e.operador ?? 'El operador'} aceptó el viaje ${e.folio}` },
  en_seguimiento_importado: { Icono: Truck, tono: 'muted', texto: (e) => `El viaje ${e.folio} entró en seguimiento por importación (no lo aceptó el chofer)` },
  // AUDITORÍA A8 ESCALACIÓN (hallazgo confirmado, mig. 0854): el "no" explícito ya deja rastro — antes esta respuesta no aparecía en ningún lado.
  rechazado: { Icono: Ban, tono: 'bad', texto: (e) => `${e.operador ?? 'El operador'} dijo que NO le toca el viaje ${e.folio}` },
  escalado: { Icono: Flag, tono: 'bad', texto: (e) => `Escaló el viaje ${e.folio} al jefe — nadie aceptaba` },
  llegada: { Icono: MapPin, tono: 'ok', texto: (e) => `${e.operador ?? 'El operador'} avisó que llegó (${e.folio})` },
  descarga: { Icono: Package, tono: 'warn', texto: (e) => `${e.operador ?? 'El operador'} está descargando (${e.folio})` },
  regreso: { Icono: Truck, tono: 'muted', texto: (e) => `${e.operador ?? 'El operador'} va de regreso (${e.folio})` },
};

/** Los cuatro conteos de arriba, ya medidos en la base. */
export interface ConteosConductores {
  vivos: number | null;
  /** Aceptados POR EL CHOFER (T-A5-06): excluye los de importación. */
  aceptados: number | null;
  /** En seguimiento del agente por importación, no por el chofer. Opcional:
   *  un origen que no lo manda no pinta la tarjeta. */
  importados?: number | null;

  /** Tiempo medio avisado → aceptó, SOLO del chofer (T-A5-06). `null` = no se
   *  pudo leer; `minutos: null` = ningún viaje medible. Opcional: un origen que
   *  no lo manda no pinta la tarjeta. */
  tiempoAceptacion?: { minutos: number | null; n: number; excluidosImportados: number } | null;
  esperan: number | null;
  escalados: number | null;
}

/** La cola listada y lo que hace falta para rotularla honestamente. */
export interface ColaConductores {
  esperan: EsperaAceptar[];
  /** Cuántos hay en TODA la flota (`count` en la base). `null` = no se pudo
   *  contar; sin él no se puede declarar la diferencia con lo listado. */
  totalEsperan: number | null;
  /** Vivos SIN aviso — el fallo silencioso que se enseña. `null` = no se
   *  pudo contar, y entonces no se pinta la frase. */
  sinAvisar: number | null;
  /** CT-A345-18: la compuerta `agente_chofer_habilitado` de la flota. Si NO está habilitada, «sin aviso» no es un
   *  rezago: es que el agente tiene prohibido escribirle al chofer. Ausente = el origen no la manda (se dice «no se
   *  pudo comprobar», nunca se asume rezago). */
  compuerta?: 'habilitado' | 'apagado' | 'compuerta_ilegible';
  /** FE-6: `viajesEsperandoAceptarPaginados` no lanza — un fallo viaja aquí,
   *  para que la sección lo diga en vez de pintar "nadie debe respuesta". */
  error: string | null;
  /** FE-B1 (auditoría 28): `Pagina.truncada` de `viajesEsperandoAceptarPaginados`
   *  — `true` cuando el total real rebasa lo que esta paginación alcanza a
   *  recorrer (`paginaMax * porPagina`, repo_paginado.ts). Esta pantalla no
   *  ofrece "Siguiente" (no hay navegación por página aquí), pero sin
   *  declarar esto el jefe de tráfico no sabe que la lectura misma tiene un
   *  techo — no solo lo que se lista de esta vuelta. `undefined`/`false` =
   *  no truncado (u origen que todavía no manda el campo). */
  truncada?: boolean;
}

/**
 * La ventana del Agente de Conductores (F4): la cola honesta de aceptación,
 * la bitácora de todo lo que selló, y la carta de lo que entiende por
 * WhatsApp — que es la verdad del código, no marketing. Sin pesos: es la
 * pantalla del jefe de tráfico.
 *
 * FE-14 (22-ago-2026): recibe PROMESAS y monta un boundary por sección. Lo
 * que más se nota es "Lo que entiende por WhatsApp": es texto fijo, no lee
 * nada, y hasta hoy esperaba detrás de los cuatro `count` de la flota.
 */
export function VistaAgenteConductores({
  kpis, cola, eventos, sufijo = '', notificaciones, tablero,
}: {
  /** 0385: el tablero de hitos (semáforo, excepciones, línea de tiempo). Ya renderizado en el servidor. */
  tablero?: React.ReactNode;
  /** FE-5: los cuatro salen de `count` en la base, no de filtrar las 100
   *  filas más recientes en memoria. `null` = no se pudo contar → "—". */
  kpis: Promise<ConteosConductores>;
  cola: Promise<ColaConductores>;
  eventos: Promise<EventoConductor[] | null>;
  sufijo?: string;
  /** La sección de Notificaciones, ya renderizada en el servidor
   *  (`SeccionNotificaciones`). Entra como ReactNode y no como datos: esta
   *  vista no debe importar el motor de avisos, que trae `supabaseAdmin`. */
  notificaciones?: React.ReactNode;
}) {
  return (
    <MarcoPagina titulo="Comunicación con operadores" apoyo="La cola de aceptación por WhatsApp, lo que el agente selló y lo que entiende de lo que escriben tus operadores.">

      <Bloque mensaje="No se pudieron leer los conteos de la flota." esqueleto={<EsqCifrasV2 n={4} />}>
        <BloqueConteos kpis={kpis} />
      </Bloque>

      <nav aria-label="Herramientas del agente" className="rv-cd__herr">
        <Link href={`/dashboard/agentes/conductores/sitios${sufijo}`} className="rv-cd__enlace">Catálogo de sitios (clientes, plantas y andenes)</Link>
        <Link href={`/dashboard/agentes/conductores/estadias${sufijo}`} className="rv-cd__enlace">Estadías en andén</Link>
        <Link href={`/dashboard/agentes/conductores/configuracion${sufijo}`} className="rv-cd__enlace">Configuración (recordatorios, horario, contactos)</Link>
      </nav>

      {tablero}

      <FilaTarjetas variante="6-6">
        <Bloque mensaje="No se pudo leer la cola de aceptación." esqueleto={<EsqTablaV2 />}>
          <BloqueCola cola={cola} sufijo={sufijo} />
        </Bloque>
        <Bloque mensaje="No se pudo leer la bitácora." esqueleto={<EsqTablaV2 />}>
          <BloqueBitacora eventos={eventos} />
        </Bloque>
      </FilaTarjetas>

      {/* Lo que entiende — la verdad del código, como onboarding. Texto
          fijo: sale con el primer flush, sin esperar a una sola consulta. */}
      <Tarjeta titulo="Lo que entiende por WhatsApp" info="conductores.entiende">
        <div className="rv-cd__tres">
          <div className="rv-cd__col">
            <p className="rv-cd__rotulo">El chofer avisa</p>
            <p className="rv-cd__nota">
              «ya llegué» · «estoy descargando» · «voy de regreso» — cada uno queda
              sellado con su hora. Y cada foto de recibo se anota sola en su viaje.
            </p>
          </div>
          <div className="rv-cd__col">
            <p className="rv-cd__rotulo">El jefe despacha</p>
            <p className="rv-cd__nota">
              «nuevo viaje para Juan Pérez, Puebla a Monterrey, anticipo 8000» —
              el agente confirma antes de crear, y al confirmar el chofer recibe su aviso.
            </p>
          </div>
          <div className="rv-cd__col">
            <p className="rv-cd__rotulo">Solo, sin que nadie pida</p>
            <p className="rv-cd__nota">
              Persigue la aceptación del viaje y a las {HORAS_PARA_ESCALAR} horas sin respuesta
              escala al jefe. Corre con las reglas de fábrica — aún no tiene estrategia editable.
            </p>
          </div>
        </div>
      </Tarjeta>

      {notificaciones}
    </MarcoPagina>
  );
}

export async function BloqueConteos({ kpis: p }: { kpis: Promise<ConteosConductores> }) {
  const kpis = await p;
  return (
    <div className="rv-cd__pila--s">
      <TiraCifras sello={selloHoy('Viajes de la flota')}>
        <Cifra etiqueta="Viajes en curso" info="conductores.viajes_en_curso" valor={kpis.vivos === null ? '—' : numero(kpis.vivos)}
          nota={kpis.vivos === null ? 'no se pudo contar' : 'abiertos o en cuadre'} />
        <Cifra etiqueta="Aceptados" info="conductores.aceptados" valor={kpis.aceptados === null ? '—' : numero(kpis.aceptados)}
          nota={kpis.aceptados === null ? 'no se pudo contar' : 'el chofer dijo que sí'} />
        {kpis.importados !== undefined && (
          <Cifra etiqueta="En seguimiento por importación" info="conductores.importados" valor={kpis.importados === null ? '—' : numero(kpis.importados)}
            nota={kpis.importados === null ? 'no se pudo contar' : 'cargados por archivo; no los aceptó el chofer'} />
        )}
        {kpis.tiempoAceptacion !== undefined && (
          <Cifra etiqueta="Tiempo en aceptar" info="conductores.tiempo_aceptar"
            valor={kpis.tiempoAceptacion === null || kpis.tiempoAceptacion.minutos === null
              ? '—' : `${numero(Math.round(kpis.tiempoAceptacion.minutos * 10) / 10)} min`}
            nota={kpis.tiempoAceptacion === null ? 'no se pudo medir'
              : kpis.tiempoAceptacion.minutos === null ? 'aún sin aceptaciones del chofer que medir'
                : `media de ${numero(kpis.tiempoAceptacion.n)} aceptados por el chofer (200 viajes recientes); no cuenta ${numero(kpis.tiempoAceptacion.excluidosImportados)} por importación`} />
        )}
        <Cifra etiqueta="Esperan aceptar" info="conductores.esperan" valor={kpis.esperan === null ? '—' : numero(kpis.esperan)}
          nota={kpis.esperan === null ? 'no se pudo contar' : undefined}
          tono={(kpis.esperan ?? 0) > 0 ? 'warn' : undefined} />
        <Cifra etiqueta="Escalados" info="conductores.escalados" valor={kpis.escalados === null ? '—' : numero(kpis.escalados)}
          nota={kpis.escalados === null ? 'no se pudo contar' : 'esperan cambio de chofer'}
          tono={(kpis.escalados ?? 0) > 0 ? 'bad' : undefined} />
      </TiraCifras>
      {/* FE-5: aquí decía "se calculan sobre los 100 viajes más
          recientes" — un rótulo honesto sobre una cifra inútil (a 50k
          viajes/mes, 100 filas son ~90 minutos). Los cuatro conteos
          ahora salen de la base y cubren TODOS los viajes en curso de
          la flota; lo único acotado es la LISTA de abajo, que lo dice
          en su propio pie. */}
      <p className="rv-cd__micro">
        Los conteos son de toda la flota y de los viajes en curso (abiertos o en cuadre);
        Escalados cuenta solo los viajes en curso escalados y sin aceptar.
      </p>
    </div>
  );
}

/** Exportado para pruebas: `renderToStaticMarkup` no monta `<Bloque>`
 *  (Suspense de servidor), así que la prueba de FE-6 llama esta pieza
 *  directamente con la promesa ya resuelta. */
export async function BloqueCola({ cola, sufijo }: {
  cola: Promise<ColaConductores>; sufijo: string;
}) {
  const { esperan, totalEsperan, sinAvisar, error, truncada = false, compuerta } = await cola;
  return (
    /* La cola honesta de aceptación */
    <Tarjeta titulo="Esperan aceptar" info="conductores.cola">
      <div className="rv-cd__pila">
        <p className="rv-cd__micro">
          Avisados sin respuesta — a las {HORAS_PARA_ESCALAR} horas el agente escala al jefe solo
        </p>
        {error !== null ? (
          <EstadoError compacto>No se pudo leer la cola de aceptación ahora mismo.</EstadoError>
        ) : esperan.length === 0 ? (
          <EstadoVacio titulo="Nadie debe respuesta" contenido>
            Nadie debe respuesta ahora mismo — cada viaje avisado está aceptado o ya se escaló.
          </EstadoVacio>
        ) : null}
        {error === null && esperan.length > 0 && (
          <ul className="rv-cd__lista">
            {esperan.map((v) => (
              <li key={v.id} className="rv-cd__linea rv-cd__nota">
                <span className="rv-cd__medio">{v.folio}</span>
                {esFolioSimulado(v.folio) && <EtiquetaSimulado />}
                <span className="rv-cd__recorta">{v.operadorNombre ?? 'Sin operador'}</span>
                <span className="rv-cd__fin cifra-mono" data-tono={v.horasDesdeAviso >= HORAS_PARA_ESCALAR ? 'warn' : undefined}>
                  {v.horasDesdeAviso === 0 ? 'hace menos de 1 h' : `hace ${numero(v.horasDesdeAviso)} h`}
                </span>
                {v.avisos > 1 && <StatusChip tono="muted">×{v.avisos}</StatusChip>}
              </li>
            ))}
          </ul>
        )}
        {/* Cuántas filas se listan de cuántas hay. La lista sale de los
            100 viajes recientes (para decir "hace N horas" hace falta la
            fila); el conteo de arriba es el de la flota. Callar la
            diferencia haría que la lista pareciera la cola completa. */}
        {/* FE-6: la lista ya viene ordenada por antigüedad del aviso (el más
            urgente primero) — lo que sobra del tope son los avisados hace MENOS
            tiempo, no viajes "más antiguos" que la lista no alcanzó a leer. */}
        {totalEsperan !== null && totalEsperan > esperan.length && (
          <p className="rv-cd__micro">
            Se listan {numero(esperan.length)} de {numero(totalEsperan)}, los más urgentes primero — el resto
            espera menos tiempo; están en el <Link href={`/dashboard/viajes${sufijo}`} className="rv-cd__enlace">registro</Link>.
          </p>
        )}
        {sinAvisar !== null && sinAvisar > 0 && (
          <p className="rv-cd__nota" data-tono="warn" data-sin-aviso={compuerta ?? 'sin_dato'}>
            {numero(sinAvisar)} viaje{sinAvisar === 1 ? '' : 's'} en curso sin aviso al operador.{' '}
            {compuerta === 'habilitado'
              ? <>El aviso sale desde <Link href={`/dashboard/despacho${sufijo}`} className="rv-cd__enlace">Despacho</Link>.</>
              : compuerta === 'apagado'
                ? 'El Agente de Conductores todavía no está habilitado en tu cuenta, por eso no avisa a los operadores: no es un rezago. Likida lo habilita cuando termina la puesta en marcha.'
                : 'No pudimos comprobar si el Agente de Conductores está habilitado en tu cuenta; no lo damos por activo.'}
          </p>
        )}
        {/* FE-B1: aquí no hay "Siguiente" que quede muerto (esta pantalla no
            pagina por URL), pero sin esto la lectura tenía un techo que nunca
            se decía — mismo patrón que `despacho/vista.tsx` y
            `descarga-sat/bandeja/vista.tsx`. */}
        {truncada && (
          <p className="rv-cd__nota" data-tono="warn">
            Esta lista no alcanza a traerlos a todos: hay más esperando aceptar de los que una sola
            lectura puede recorrer — revisa el{' '}
            <Link href={`/dashboard/viajes${sufijo}`} className="rv-cd__enlace">registro</Link> para lo que
            sobra.
          </p>
        )}
      </div>
    </Tarjeta>
  );
}

async function BloqueBitacora({ eventos: p }: { eventos: Promise<EventoConductor[] | null> }) {
  const eventos = await p;
  return (
    /* Bitácora */
    <Tarjeta titulo="Bitácora" info="conductores.bitacora"
      estado={eventos === null ? 'error' : eventos.length === 0 ? 'vacio' : 'ok'}
      mensaje={eventos === null ? 'No se pudo leer la bitácora ahora mismo.' : 'Aún sin actividad'}
      detalle="Cada aviso, aceptación, escalación o hito del chofer queda escrito aquí.">
      <div className="rv-cd__pila">
        <p className="rv-cd__micro">Los últimos sellos, sobre los 60 viajes más recientes</p>
        <ul className="rv-cd__lista">
          {(eventos ?? []).map((e, i) => {
            const cfg = EVENTO[e.tipo];
            return (
              <li key={i} className="rv-cd__icono-linea" data-tono={cfg.tono === 'bad' ? undefined : cfg.tono}>
                <Icono icono={cfg.Icono} tam={14} />
                <div>
                  <span className="rv-cd__sin-color">{cfg.texto(e)}</span>
                  {esFolioSimulado(e.folio) && <> <EtiquetaSimulado /></>}
                  <span className="rv-cd__micro rv-cd__bloquear">{fechaCorta(e.cuando)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Tarjeta>
  );
}



// ═══════════════════════════════════════════════════════════════════════════
// T-A5-32 — LOS INSIGHTS: qué pasó · qué significa · qué hacer (12 §F4).
//
// Cada pantalla de agente trae resumen + interpretación + siguiente paso, y TODO número con su fuente y su rótulo
// («medido» / «estimación»). Sin IA: el texto sale de `calcularInsights` (puro). Sin línea base NO hay cifra de ahorro:
// se pide la línea base. Un tiempo del chofer es retraso de ENTREGA del mensaje, nunca la hora del evento físico.
// ═══════════════════════════════════════════════════════════════════════════

export interface TextoInsights {
  quePaso: string[];
  queSignifica: string[];
  queHacer: string[];
}

const minutos = (v: number | null) => (v === null ? null : `${numero(Math.round(v * 10) / 10)} min`);

/** Las tres secciones, en lenguaje llano. `discrepancias` = hitos del chofer que la ubicación no confirmó (medido en el tablero); `null` = no disponible. */
export function textoInsights(i: InsightsConductor, discrepancias: number | null): TextoInsights {
  const total = i.hitosRegistrados.valor;
  const sin = i.sinIntervencion.valor;
  if (total === 0) {
    return {
      quePaso: ['Todavía no hay hitos registrados en este periodo.'],
      queSignifica: ['Sin hitos no hay nada que medir: ninguna cifra de ahorro se estima sobre cero.'],
      queHacer: ['Activa el seguimiento en los viajes de los operadores voluntarios y vuelve a revisar cuando haya hitos.'],
    };
  }
  const quePaso = [`${numero(sin)} de ${numero(total)} hitos se registraron sin que nadie los capturara${i.sinIntervencion.porcentaje !== null ? ` (${numero(i.sinIntervencion.porcentaje)} %)` : ''}.`];
  if (i.deOficina.valor > 0) quePaso.push(`La oficina corrigió o capturó ${numero(i.deOficina.valor)}.`);
  const g = minutos(i.retrasoGps.promedioMin);
  if (g) quePaso.push(`Entre que el GPS detecta el cruce y se registra pasan ${g} en promedio (${numero(i.retrasoGps.mediciones)} mediciones).`);
  const c = minutos(i.retrasoChofer.promedioMin);
  if (c) quePaso.push(`Los mensajes del chofer tardan ${c} en llegar, en promedio (${numero(i.retrasoChofer.mediciones)} mediciones).`);
  if (discrepancias !== null && discrepancias > 0) quePaso.push(`Hay ${numero(discrepancias)} hitos donde lo que dijo el chofer no coincide con la ubicación del GPS.`);

  const queSignifica = [`Tu equipo dejó de teclear esos ${numero(sin)} registros.`];
  if (i.llamadasEvitadas.valor !== null) queSignifica.push(`${i.llamadasEvitadas.mensaje}: unas ${numero(i.llamadasEvitadas.valor)} llamadas evitadas (estimación, no medición).`);
  else queSignifica.push('No se puede estimar cuántas llamadas se evitaron sin tu línea base.');
  if (c) queSignifica.push('El tiempo del chofer mide la entrega del mensaje, no cuándo ocurrió el evento físico.');

  const queHacer: string[] = [];
  if (i.deOficina.valor > 0) queHacer.push(`Revisa los ${numero(i.deOficina.valor)} que corrigió la oficina.`);
  const ex = i.excepciones;
  if (ex.sinRespuesta.valor > 0) queHacer.push(`Atiende ${numero(ex.sinRespuesta.valor)} hitos escalados por falta de respuesta.`);
  if (ex.sinSenal.valor > 0) queHacer.push(`Revisa ${numero(ex.sinSenal.valor)} episodios de «sin señal de vida» del periodo.`);
  if (ex.sinSitio.valor !== null && ex.sinSitio.valor > 0) queHacer.push(`Asigna sitio a ${numero(ex.sinSitio.valor)} viajes que el GPS no pudo evaluar.`);
  if (discrepancias !== null && discrepancias > 0) queHacer.push('Compara los hitos que el GPS no confirmó contra lo que dijo el chofer.');
  if (i.llamadasEvitadas.valor === null) queHacer.push(MENSAJE_SIN_LINEA_BASE + ' (se captura en Configuración).');
  if (queHacer.length === 0) queHacer.push('Nada urgente: sigue el seguimiento y revisa de nuevo mañana.');
  return { quePaso, queSignifica, queHacer };
}

function FilaFuente({ etiqueta, valor, cifra }: { etiqueta: string; valor: string; cifra: { fuente: string; rotulo: string } }) {
  return (
    <li className="rv-cd__linea rv-cd__nota">
      <span>{etiqueta}</span>
      <span className="tabular-nums rv-cd__medio">{valor}</span>
      <span>· {cifra.rotulo} · fuente: {fuenteLegible(cifra.fuente)}</span>
    </li>
  );
}

/** T-A5-61: una línea de KPI del piloto. Sin valor o sin línea base válida dice «sin dato»; nunca inventa un porcentaje. */
function textoKpiPiloto(k: KpiPiloto): { valor: string; comparacion: string } {
  const sufijo = k.unidad.startsWith('%') ? ' %' : k.unidad.startsWith('min') ? ' min' : '';
  const valor = k.valor === null ? 'sin dato' : `${numero(k.valor)}${sufijo}`;
  const c = k.contraBase;
  if (c === 'sin dato') return { valor, comparacion: 'sin línea base' };
  const partes = [`base ${numero(c.lineaBase)}${sufijo}`];
  if (c.mejoraPct !== null) partes.push(`mejora ${numero(c.mejoraPct)} %`);
  else if (c.diferencia !== null) partes.push(`diferencia ${c.diferencia > 0 ? '+' : ''}${numero(c.diferencia)}${sufijo}`);
  return { valor, comparacion: partes.join(' · ') };
}

const valorCifra = (c: CifraDato<number | null>) => (c.valor === null ? '—' : numero(c.valor));

/** La tarjeta de arriba del tablero. `insights = null` = no se pudo leer (se dice; no se pinta «0»). */
export function TarjetaInsights({ insights, dias, discrepancias = null, recortada = false }: {
  insights: InsightsConductor | null; dias: number; discrepancias?: number | null; recortada?: boolean;
}) {
  if (insights === null) {
    return <Tarjeta titulo="Insights del agente" info="conductores.insights" estado="error" mensaje="No se pudieron leer los insights del periodo." />;
  }
  const t = textoInsights(insights, discrepancias);
  const ex = insights.excepciones;
  const seccion = (titulo: string, lineas: string[]) => (
    <div className="rv-cd__col">
      <p className="rv-cd__rotulo">{titulo}</p>
      <ul className="rv-cd__ul">{lineas.map((l, k) => <li key={k}>{l}</li>)}</ul>
    </div>
  );
  return (
    <Tarjeta titulo={`Insights de los últimos ${numero(dias)} ${dias === 1 ? 'día' : 'días'}`} info="conductores.insights">
      <div className="rv-cd__pila">
        <div className="rv-cd__columnas">
          {seccion('Qué pasó', t.quePaso)}
          {seccion('Qué significa', t.queSignifica)}
          {seccion('Qué hacer', t.queHacer)}
        </div>
        <section aria-label="KPIs del piloto" className="rv-cd__pila">
          <p className="rv-cd__rotulo">KPIs del piloto</p>
          <ul className="rv-cd__kpis">
            {insights.kpisPiloto.map((k) => {
              const t2 = textoKpiPiloto(k);
              return (
                <li key={k.id} className="rv-cd__kpi">
                  <div className="rv-cd__nota">{k.nombre}</div>
                  <div className="rv-cd__kpi-valor">{t2.valor}</div>
                  <div className="rv-cd__nota">{k.rotulo} · {t2.comparacion}</div>
                </li>
              );
            })}
          </ul>
          {insights.kpisPiloto.some((k) => k.contraBase === 'sin dato') && (
            <p className="rv-cd__nota">
              Aún no hay línea base declarada para algunos indicadores: indícala en{' '}
              <Link href="/dashboard/agentes/conductores/configuracion" className="rv-cd__enlace">Configuración</Link>{' '}
              para medir el ahorro. Sin ella no se compara contra tu situación anterior.
            </p>
          )}
        </section>
        <Disclosure titulo="De dónde sale cada número" variante="linea">
          <ul className="rv-cd__lista">
            <FilaFuente etiqueta="Hitos registrados" valor={numero(insights.hitosRegistrados.valor)} cifra={insights.hitosRegistrados} />
            <FilaFuente etiqueta="Sin intervención" valor={numero(insights.sinIntervencion.valor)} cifra={insights.sinIntervencion} />
            <FilaFuente etiqueta="De la oficina" valor={numero(insights.deOficina.valor)} cifra={insights.deOficina} />
            <FilaFuente etiqueta="Retraso GPS" valor={minutos(insights.retrasoGps.promedioMin) ?? '—'} cifra={insights.retrasoGps} />
            <FilaFuente etiqueta="Retraso de entrega del chofer" valor={minutos(insights.retrasoChofer.promedioMin) ?? '—'} cifra={insights.retrasoChofer} />
            <FilaFuente etiqueta="Llamadas evitadas" valor={valorCifra(insights.llamadasEvitadas)} cifra={insights.llamadasEvitadas} />
            <FilaFuente etiqueta="Hitos sin respuesta" valor={numero(ex.sinRespuesta.valor)} cifra={ex.sinRespuesta} />
            <FilaFuente etiqueta="Viajes sin sitio" valor={valorCifra(ex.sinSitio)} cifra={ex.sinSitio} />
            <FilaFuente etiqueta="Episodios sin señal" valor={numero(ex.sinSenal.valor)} cifra={ex.sinSenal} />
            <FilaFuente etiqueta="Primer aviso / segundo / jefe" valor={`${numero(insights.escalera.aviso1.valor)} / ${numero(insights.escalera.aviso2.valor)} / ${numero(insights.escalera.jefe.valor)}`} cifra={insights.escalera.aviso1} />
            {discrepancias !== null && (
              <FilaFuente etiqueta="Chofer vs GPS sin coincidir" valor={numero(discrepancias)} cifra={{ rotulo: 'medido', fuente: 'validación de ubicación de cada hito' }} />
            )}
          </ul>
          {recortada && <p className="rv-cd__nota" data-tono="warn">La lectura llegó a su tope: las cifras cubren solo lo más reciente del periodo.</p>}
        </Disclosure>
      </div>
    </Tarjeta>
  );
}
