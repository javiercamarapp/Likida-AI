import Link from 'next/link';
import { Send, CheckCheck, Flag, MapPin, Package, Truck, Ban } from 'lucide-react';
import type { EventoConductor } from '@/lib/likida/analytics';
import { HORAS_PARA_ESCALAR } from '@/lib/likida/escalar_viaje';
import { numero, fechaCorta } from '@/lib/formato';
import './conductores.css';
import { Bloque } from '../../bloque';
import { esFolioSimulado } from '@/lib/likida/conductor/tablero';
import { EtiquetaSimulado } from './tablero-hitos';
import { MENSAJE_SIN_LINEA_BASE, type Cifra as CifraDato, type InsightsConductor, type KpiPiloto } from '@/lib/likida/conductor/insights';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { Disclosure, EsqCifrasV2, EstadoError, EstadoVacio, EsqTablaV2, FilaTarjetas, Icono, MarcoPagina, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import { fuenteLegible } from '@/app/dashboard/lenguaje-cliente';
import { TR_ES, rico, type TrAgentes, type TAgentes, selloHoyTr } from '../i18n-agentes';
import { getT } from '@/lib/i18n/servidor';

export interface EsperaAceptar {
  id: string;
  folio: string;
  operadorNombre: string | null;
  /** Horas COMPLETAS desde el aviso — medidas, se rotulan así. */
  horasDesdeAviso: number;
  avisos: number;
}

/** Cómo se lee cada sello en la bitácora. Un tipo nuevo cae al crudo. */
const EVENTO = (tx: TAgentes): Record<EventoConductor['tipo'], { Icono: typeof Send; texto: (e: EventoConductor) => string; tono: 'ok' | 'bad' | 'warn' | 'muted' }> => ({
  avisado: { Icono: Send, tono: 'muted', texto: (e) => tx('conductores.vista.le_aviso_a_de_su', { v0: e.operador ?? tx('conductores.vista.el_operador_2'), folio: e.folio }) },
  acepto: { Icono: CheckCheck, tono: 'ok', texto: (e) => tx('conductores.vista.acepto_el_viaje', { v0: e.operador ?? tx('conductores.vista.el_operador'), folio: e.folio }) },
  en_seguimiento_importado: { Icono: Truck, tono: 'muted', texto: (e) => tx('conductores.vista.el_viaje_entro_en_seguimiento', { folio: e.folio }) },
  // AUDITORÍA A8 ESCALACIÓN (hallazgo confirmado, mig. 0854): el "no" explícito ya deja rastro — antes esta respuesta no aparecía en ningún lado.
  rechazado: { Icono: Ban, tono: 'bad', texto: (e) => tx('conductores.vista.dijo_que_no_le_toca', { v0: e.operador ?? tx('conductores.vista.el_operador'), folio: e.folio }) },
  escalado: { Icono: Flag, tono: 'bad', texto: (e) => tx('conductores.vista.escalo_el_viaje_al_jefe', { folio: e.folio }) },
  llegada: { Icono: MapPin, tono: 'ok', texto: (e) => tx('conductores.vista.aviso_que_llego', { v0: e.operador ?? tx('conductores.vista.el_operador'), folio: e.folio }) },
  descarga: { Icono: Package, tono: 'warn', texto: (e) => tx('conductores.vista.esta_descargando', { v0: e.operador ?? tx('conductores.vista.el_operador'), folio: e.folio }) },
  regreso: { Icono: Truck, tono: 'muted', texto: (e) => tx('conductores.vista.va_de_regreso', { operador: e.operador ?? tx('conductores.vista.el_operador'), folio: e.folio }) },
});

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
  kpis, cola, eventos, sufijo = '', notificaciones, tablero, avisos, tr = TR_ES,
}: {
  /** Los avisos de la flota (preflight): van ANTES de la tira de cifras, como en Rovaq (cabecera → avisos → cifras). */
  avisos?: React.ReactNode;
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
  notificaciones?: React.ReactNode; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  return (
    <MarcoPagina titulo={tx('conductores.vista.comunicacion_con_operadores')} apoyo={tx('conductores.vista.la_cola_de_aceptacion_por')}>

      {avisos}

      <Bloque mensaje={tx('conductores.vista.no_se_pudieron_leer_los')} esqueleto={<EsqCifrasV2 n={4} />}>
        <BloqueConteos kpis={kpis} />
      </Bloque>

      {tablero}

      <FilaTarjetas variante="6-6">
        <Bloque mensaje={tx('conductores.vista.no_se_pudo_leer_la')} esqueleto={<EsqTablaV2 />}>
          <BloqueCola cola={cola} sufijo={sufijo} />
        </Bloque>
        <Bloque mensaje={tx('conductores.vista.no_se_pudo_leer_la_2')} esqueleto={<EsqTablaV2 />}>
          <BloqueBitacora eventos={eventos} />
        </Bloque>
      </FilaTarjetas>

      {/* Lo que entiende — la verdad del código, como onboarding. Texto
          fijo: sale con el primer flush, sin esperar a una sola consulta. */}
      <Tarjeta titulo={tx('conductores.vista.lo_que_entiende_por_whatsapp')} info="conductores.entiende">
        <div className="rv-cd__tres">
          <div className="rv-cd__col">
            <p className="rv-cd__rotulo">{tx('conductores.vista.el_chofer_avisa')}</p>
            <p className="rv-cd__nota">
              {tx('conductores.vista.ya_llegue_estoy_descargando_voy')}
            </p>
          </div>
          <div className="rv-cd__col">
            <p className="rv-cd__rotulo">{tx('conductores.vista.el_jefe_despacha')}</p>
            <p className="rv-cd__nota">
              {tx('conductores.vista.nuevo_viaje_para_juan_perez')}
            </p>
          </div>
          <div className="rv-cd__col">
            <p className="rv-cd__rotulo">{tx('conductores.vista.solo_sin_que_nadie_pida')}</p>
            <p className="rv-cd__nota">
              {tx('conductores.vista.persigue_la_aceptacion_del_viaje', { HORAS_PARA_ESCALAR })}
            </p>
          </div>
        </div>
      </Tarjeta>

      {notificaciones}
    </MarcoPagina>
  );
}

export async function BloqueConteos({ kpis: p }: { kpis: Promise<ConteosConductores> }) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const kpis = await p;
  return (
    <div className="rv-cd__pila--s rv-ag-sin-filete">
      {/* UNA tira de 4 celdas iguales (Rovaq `pc-kpis`, sin filete). Lo demás del conteo (importados, tiempo en aceptar) va debajo, en la rejilla de indicadores. */}
      <TiraCifras sello={selloHoyTr(tr, tx('conductores.vista.viajes_de_la_flota'))}>
        <Cifra etiqueta={tx('conductores.vista.viajes_en_curso')} info="conductores.viajes_en_curso" valor={kpis.vivos === null ? '—' : numero(kpis.vivos)}
          nota={kpis.vivos === null ? tx('conductores.vista.no_se_pudo_contar') : tx('conductores.vista.abiertos_o_en_cuadre')} />
        <Cifra etiqueta={tx('conductores.vista.aceptados')} info="conductores.aceptados" valor={kpis.aceptados === null ? '—' : numero(kpis.aceptados)}
          nota={kpis.aceptados === null ? tx('conductores.vista.no_se_pudo_contar') : tx('conductores.vista.el_chofer_dijo_que_si')} />
        <Cifra etiqueta={tx('conductores.vista.esperan_aceptar')} info="conductores.esperan" valor={kpis.esperan === null ? '—' : numero(kpis.esperan)}
          nota={kpis.esperan === null ? tx('conductores.vista.no_se_pudo_contar') : undefined}
          tono={(kpis.esperan ?? 0) > 0 ? 'warn' : undefined} />
        <Cifra etiqueta={tx('conductores.vista.escalados')} info="conductores.escalados" valor={kpis.escalados === null ? '—' : numero(kpis.escalados)}
          nota={kpis.escalados === null ? tx('conductores.vista.no_se_pudo_contar') : 'esperan cambio de chofer'}
          tono={(kpis.escalados ?? 0) > 0 ? 'bad' : undefined} />
      </TiraCifras>
      {(kpis.importados !== undefined || kpis.tiempoAceptacion !== undefined) && (
        <Tarjeta titulo={tx('f26d6.cd.seguimiento_flota')}>
        <dl className="rv-ag-indic">
          {kpis.importados !== undefined && (
            <div>
              <dt>{tx('conductores.vista.en_seguimiento_por_importacion')}</dt>
              <dd><span className="rv-ag-indic__valor" data-vacio={kpis.importados === null || undefined}>{kpis.importados === null ? '—' : numero(kpis.importados)}</span></dd>
              <dd className="rv-ag-indic__nota">{kpis.importados === null ? tx('conductores.vista.no_se_pudo_contar') : tx('conductores.vista.cargados_por_archivo_no_los')}</dd>
            </div>
          )}
          {kpis.tiempoAceptacion !== undefined && (
            <div>
              <dt>{tx('conductores.vista.tiempo_en_aceptar')}</dt>
              <dd><span className="rv-ag-indic__valor" data-vacio={kpis.tiempoAceptacion === null || kpis.tiempoAceptacion.minutos === null || undefined}>
                {kpis.tiempoAceptacion === null || kpis.tiempoAceptacion.minutos === null ? '—' : `${numero(Math.round(kpis.tiempoAceptacion.minutos * 10) / 10)} min`}</span></dd>
              <dd className="rv-ag-indic__nota">{kpis.tiempoAceptacion === null ? tx('conductores.vista.no_se_pudo_medir')
                : kpis.tiempoAceptacion.minutos === null ? tx('conductores.vista.aun_sin_aceptaciones_del_chofer')
                  : tx('conductores.vista.media_de_aceptados_por_el', { n: numero(kpis.tiempoAceptacion.n), excluidosImportados: numero(kpis.tiempoAceptacion.excluidosImportados) })}</dd>
            </div>
          )}
        </dl>
        <p className="rv-cd__micro">
          {tx('conductores.vista.los_conteos_son_de_toda')}
        </p>
        </Tarjeta>
      )}
      {/* FE-5: aquí decía "se calculan sobre los 100 viajes más
          recientes" — un rótulo honesto sobre una cifra inútil (a 50k
          viajes/mes, 100 filas son ~90 minutos). Los cuatro conteos
          ahora salen de la base y cubren TODOS los viajes en curso de
          la flota; lo único acotado es la LISTA de abajo, que lo dice
          en su propio pie. */}
      {kpis.importados === undefined && kpis.tiempoAceptacion === undefined && (
        <p className="rv-cd__micro">
          {tx('conductores.vista.los_conteos_son_de_toda')}
        </p>
      )}
    </div>
  );
}

/** Exportado para pruebas: `renderToStaticMarkup` no monta `<Bloque>`
 *  (Suspense de servidor), así que la prueba de FE-6 llama esta pieza
 *  directamente con la promesa ya resuelta. */
export async function BloqueCola({ cola, sufijo }: {
  cola: Promise<ColaConductores>; sufijo: string;
}) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const { esperan, totalEsperan, sinAvisar, error, truncada = false, compuerta } = await cola;
  return (
    /* La cola honesta de aceptación */
    <Tarjeta titulo={tx('conductores.vista.esperan_aceptar')} info="conductores.cola">
      <div className="rv-cd__pila">
        <p className="rv-cd__micro">
          {tx('conductores.vista.avisados_sin_respuesta_a_las', { HORAS_PARA_ESCALAR })}
        </p>
        {error !== null ? (
          <EstadoError compacto>{tx('conductores.vista.no_se_pudo_leer_la_3')}</EstadoError>
        ) : esperan.length === 0 ? (
          <EstadoVacio titulo={tx('conductores.vista.nadie_debe_respuesta')} contenido>
            {tx('conductores.vista.nadie_debe_respuesta_ahora_mismo')}
          </EstadoVacio>
        ) : null}
        {error === null && esperan.length > 0 && (
          <ul className="rv-cd__lista">
            {esperan.map((v) => (
              <li key={v.id} className="rv-cd__linea rv-cd__nota">
                <span className="rv-cd__medio">{v.folio}</span>
                {esFolioSimulado(v.folio) && <EtiquetaSimulado />}
                <span className="rv-cd__recorta">{v.operadorNombre ?? tx('conductores.vista.sin_operador')}</span>
                <span className="rv-cd__fin rv-ag-num" data-tono={v.horasDesdeAviso >= HORAS_PARA_ESCALAR ? 'warn' : undefined}>
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
            {rico(tx('conductores.vista.se_listan_de_los_mas'), { length: numero(esperan.length), totalEsperan: numero(totalEsperan), Link: <Link href={`/dashboard/viajes${sufijo}`} className="rv-cd__enlace">{tx('conductores.vista.registro')}</Link> })}
          </p>
        )}
        {sinAvisar !== null && sinAvisar > 0 && (
          <p className="rv-cd__nota" data-tono="warn" data-sin-aviso={compuerta ?? 'sin_dato'}>
            {rico(tr.tp('conductores.vista.sin_aviso', sinAvisar, { n: numero(sinAvisar) }), { nota: compuerta === 'habilitado'
              ? <>{rico(tx('conductores.vista.el_aviso_sale_desde'), { Link: <Link href={`/dashboard/despacho${sufijo}`} className="rv-cd__enlace">{tx('conductores.vista.despacho')}</Link> })}</>
              : compuerta === 'apagado'
                ? tx('conductores.vista.el_agente_de_conductores_todavia')
                : tx('conductores.vista.no_pudimos_comprobar_si_el') })}
          </p>
        )}
        {/* FE-B1: aquí no hay "Siguiente" que quede muerto (esta pantalla no
            pagina por URL), pero sin esto la lectura tenía un techo que nunca
            se decía — mismo patrón que `despacho/vista.tsx` y
            `descarga-sat/bandeja/vista.tsx`. */}
        {truncada && (
          <p className="rv-cd__nota" data-tono="warn">
            {rico(tx('conductores.vista.esta_lista_no_alcanza_a'), { v0: ' ', Link: <Link href={`/dashboard/viajes${sufijo}`} className="rv-cd__enlace">{tx('conductores.vista.registro')}</Link> })}
          </p>
        )}
      </div>
    </Tarjeta>
  );
}

async function BloqueBitacora({ eventos: p }: { eventos: Promise<EventoConductor[] | null> }) {
  const tr = await getT('agentes');
  const { t: tx } = tr;
  const eventos = await p;
  return (
    /* Bitácora */
    <Tarjeta titulo={tx('conductores.vista.bitacora')} info="conductores.bitacora"
      estado={eventos === null ? 'error' : eventos.length === 0 ? 'vacio' : 'ok'}
      mensaje={eventos === null ? tx('conductores.vista.no_se_pudo_leer_la_4') : tx('conductores.vista.aun_sin_actividad')}
      detalle={tx('conductores.vista.cada_aviso_aceptacion_escalacion_o')}>
      <div className="rv-cd__pila">
        <p className="rv-cd__micro">{tx('conductores.vista.los_ultimos_sellos_sobre_los')}</p>
        <ul className="rv-cd__lista">
          {(eventos ?? []).map((e, i) => {
            const cfg = EVENTO(tx)[e.tipo];
            return (
              <li key={i} className="rv-cd__icono-linea" data-tono={cfg.tono === 'bad' ? undefined : cfg.tono}>
                <Icono icono={cfg.Icono} tam={14} />
                <div>
                  <span className="rv-cd__sin-color">{cfg.texto(e)}</span>
                  {esFolioSimulado(e.folio) && <> <EtiquetaSimulado /></>}
                  <span className="rv-cd__micro rv-cd__bloquear">{fechaCorta(e.cuando, tr.idioma)}</span>
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
export function textoInsights(i: InsightsConductor, discrepancias: number | null, tr: TrAgentes = TR_ES): TextoInsights {
  const { t: tx } = tr;
  const total = i.hitosRegistrados.valor;
  const sin = i.sinIntervencion.valor;
  if (total === 0) {
    return {
      quePaso: [tx('conductores.vista.todavia_no_hay_hitos_registrados')],
      queSignifica: [tx('conductores.vista.sin_hitos_no_hay_nada')],
      queHacer: [tx('conductores.vista.activa_el_seguimiento_en_los')],
    };
  }
  const quePaso = [tx('conductores.vista.de_hitos_se_registraron_sin', { sin: numero(sin), total: numero(total), v2: i.sinIntervencion.porcentaje !== null ? ` (${numero(i.sinIntervencion.porcentaje)} %)` : '' })];
  if (i.deOficina.valor > 0) quePaso.push(tx('conductores.vista.la_oficina_corrigio_o_capturo', { valor: numero(i.deOficina.valor) }));
  const g = minutos(i.retrasoGps.promedioMin);
  if (g) quePaso.push(tx('conductores.vista.entre_que_el_gps_detecta', { g, mediciones: numero(i.retrasoGps.mediciones) }));
  const c = minutos(i.retrasoChofer.promedioMin);
  if (c) quePaso.push(tx('conductores.vista.los_mensajes_del_chofer_tardan', { c, mediciones: numero(i.retrasoChofer.mediciones) }));
  if (discrepancias !== null && discrepancias > 0) quePaso.push(tx('conductores.vista.hay_hitos_donde_lo_que', { discrepancias: numero(discrepancias) }));

  const queSignifica = [tx('conductores.vista.tu_equipo_dejo_de_teclear', { sin: numero(sin) })];
  if (i.llamadasEvitadas.valor !== null) queSignifica.push(tx('conductores.vista.unas_llamadas_evitadas_estimacion_no', { mensaje: i.llamadasEvitadas.mensaje, valor: numero(i.llamadasEvitadas.valor) }));
  else queSignifica.push(tx('conductores.vista.no_se_puede_estimar_cuantas'));
  if (c) queSignifica.push(tx('conductores.vista.el_tiempo_del_chofer_mide'));

  const queHacer: string[] = [];
  if (i.deOficina.valor > 0) queHacer.push(tx('conductores.vista.revisa_los_que_corrigio_la', { valor: numero(i.deOficina.valor) }));
  const ex = i.excepciones;
  if (ex.sinRespuesta.valor > 0) queHacer.push(tx('conductores.vista.atiende_hitos_escalados_por_falta', { valor: numero(ex.sinRespuesta.valor) }));
  if (ex.sinSenal.valor > 0) queHacer.push(tx('conductores.vista.revisa_episodios_de_sin_senal', { valor: numero(ex.sinSenal.valor) }));
  if (ex.sinSitio.valor !== null && ex.sinSitio.valor > 0) queHacer.push(tx('conductores.vista.asigna_sitio_a_viajes_que', { valor: numero(ex.sinSitio.valor) }));
  if (discrepancias !== null && discrepancias > 0) queHacer.push(tx('conductores.vista.compara_los_hitos_que_el'));
  if (i.llamadasEvitadas.valor === null) queHacer.push(MENSAJE_SIN_LINEA_BASE + tx('conductores.vista.se_captura_en_configuracion'));
  if (queHacer.length === 0) queHacer.push(tx('conductores.vista.nada_urgente_sigue_el_seguimiento'));
  return { quePaso, queSignifica, queHacer };
}

function FilaFuente({ etiqueta, valor, cifra, tr = TR_ES }: { etiqueta: string; valor: string; cifra: { fuente: string; rotulo: string }; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <li className="rv-cd__linea rv-cd__nota">
      <span>{etiqueta}</span>
      <span className="tabular-nums rv-cd__medio">{valor}</span>
      <span>{tx('conductores.vista.fuente', { rotulo: cifra.rotulo, fuente: fuenteLegible(cifra.fuente) })}</span>
    </li>
  );
}

/** T-A5-61: una línea de KPI del piloto. Sin valor o sin línea base válida dice «sin dato»; nunca inventa un porcentaje. */
function textoKpiPiloto(k: KpiPiloto, tx: TAgentes): { valor: string; comparacion: string } {
  const sufijo = k.unidad.startsWith('%') ? ' %' : k.unidad.startsWith('min') ? ' min' : '';
  const valor = k.valor === null ? tx('conductores.vista.sin_dato_valor') : `${numero(k.valor)}${sufijo}`;
  const c = k.contraBase;
  if (c === 'sin dato') return { valor, comparacion: tx('conductores.vista.sin_linea_base') };
  const partes = [tx('conductores.vista.base_n', { n: numero(c.lineaBase), sufijo })];
  if (c.mejoraPct !== null) partes.push(tx('conductores.vista.mejora_pct', { n: numero(c.mejoraPct) }));
  else if (c.diferencia !== null) partes.push(tx('conductores.vista.diferencia_n', { signo: c.diferencia > 0 ? '+' : '', n: numero(c.diferencia), sufijo }));
  return { valor, comparacion: partes.join(' · ') };
}

const valorCifra = (c: CifraDato<number | null>) => (c.valor === null ? '—' : numero(c.valor));

/** La tarjeta de arriba del tablero. `insights = null` = no se pudo leer (se dice; no se pinta «0»). */
export function TarjetaInsights({ insights, dias, discrepancias = null, recortada = false, tr = TR_ES }: {
  insights: InsightsConductor | null; dias: number; discrepancias?: number | null; recortada?: boolean; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  if (insights === null) {
    return <Tarjeta titulo={tx('conductores.vista.insights_del_agente')} info="conductores.insights" estado="error" mensaje={tx('conductores.vista.no_se_pudieron_leer_los_2')} />;
  }
  const t = textoInsights(insights, discrepancias, tr);
  const ex = insights.excepciones;
  const seccion = (titulo: string, lineas: string[]) => (
    <div className="rv-cd__col">
      <p className="rv-cd__rotulo">{titulo}</p>
      <ul className="rv-cd__ul">{lineas.map((l, k) => <li key={k}>{l}</li>)}</ul>
    </div>
  );
  return (
    <Tarjeta titulo={tx('conductores.vista.insights_de_los_ultimos', { dias: numero(dias), v1: dias === 1 ? 'día' : tx('conductores.vista.dias') })} info="conductores.insights">
      <div className="rv-cd__pila">
        <div className="rv-cd__columnas">
          {seccion(tx('conductores.vista.que_paso'), t.quePaso)}
          {seccion(tx('conductores.vista.que_significa'), t.queSignifica)}
          {seccion(tx('conductores.vista.que_hacer'), t.queHacer)}
        </div>
        <section aria-label={tx('conductores.vista.kpis_del_piloto')} className="rv-cd__pila">
          <p className="rv-cd__rotulo">{tx('conductores.vista.kpis_del_piloto')}</p>
          {/* Solo las cifras con valor son tarjetas; las que no tienen dato van en un bloque plegado, con «—» y sin cifra grande. */}
          {insights.kpisPiloto.some((k) => k.valor !== null) && (
            <ul className="rv-cd__kpis">
              {insights.kpisPiloto.filter((k) => k.valor !== null).map((k) => {
                const t2 = textoKpiPiloto(k, tx);
                return (
                  <li key={k.id} className="rv-cd__kpi">
                    <div className="rv-cd__nota">{k.nombre}</div>
                    <div className="rv-cd__kpi-valor">{t2.valor}</div>
                    <div className="rv-cd__nota">{k.rotulo} · {t2.comparacion}</div>
                  </li>
                );
              })}
            </ul>
          )}
          {insights.kpisPiloto.some((k) => k.valor === null) && (
            <Disclosure titulo={tx('conductores.vista.indicadores_sin_dato', { length: insights.kpisPiloto.filter((k) => k.valor === null).length })} variante="linea">
              <ul className="rv-cd__lista">
                {insights.kpisPiloto.filter((k) => k.valor === null).map((k) => (
                  <li key={k.id}>{rico(tx('conductores.vista.sin_dato'), { span: <span className="rv-cd__medio">{k.nombre}</span>, rotulo: k.rotulo })}</li>
                ))}
              </ul>
            </Disclosure>
          )}
          {insights.kpisPiloto.some((k) => k.contraBase === 'sin dato') && (
            <p className="rv-cd__nota">
              {rico(tx('conductores.vista.aun_no_hay_linea_base'), { v0: ' ', Link: <Link href="/dashboard/agentes/conductores/configuracion" className="rv-cd__enlace">{tx('conductores.vista.configuracion')}</Link>, v2: ' ' })}
            </p>
          )}
        </section>
        <Disclosure titulo={tx('conductores.vista.de_donde_sale_cada_numero')} variante="linea">
          <ul className="rv-cd__lista">
            <FilaFuente tr={tr} etiqueta={tx('conductores.vista.hitos_registrados')} valor={numero(insights.hitosRegistrados.valor)} cifra={insights.hitosRegistrados} />
            <FilaFuente tr={tr} etiqueta={tx('conductores.vista.sin_intervencion')} valor={numero(insights.sinIntervencion.valor)} cifra={insights.sinIntervencion} />
            <FilaFuente tr={tr} etiqueta={tx('conductores.vista.de_la_oficina')} valor={numero(insights.deOficina.valor)} cifra={insights.deOficina} />
            <FilaFuente tr={tr} etiqueta={tx('conductores.vista.retraso_gps')} valor={minutos(insights.retrasoGps.promedioMin) ?? '—'} cifra={insights.retrasoGps} />
            <FilaFuente tr={tr} etiqueta={tx('conductores.vista.retraso_de_entrega_del_chofer')} valor={minutos(insights.retrasoChofer.promedioMin) ?? '—'} cifra={insights.retrasoChofer} />
            <FilaFuente tr={tr} etiqueta={tx('conductores.vista.llamadas_evitadas')} valor={valorCifra(insights.llamadasEvitadas)} cifra={insights.llamadasEvitadas} />
            <FilaFuente tr={tr} etiqueta={tx('conductores.vista.hitos_sin_respuesta')} valor={numero(ex.sinRespuesta.valor)} cifra={ex.sinRespuesta} />
            <FilaFuente tr={tr} etiqueta={tx('conductores.vista.viajes_sin_sitio')} valor={valorCifra(ex.sinSitio)} cifra={ex.sinSitio} />
            <FilaFuente tr={tr} etiqueta={tx('conductores.vista.episodios_sin_senal')} valor={numero(ex.sinSenal.valor)} cifra={ex.sinSenal} />
            <FilaFuente tr={tr} etiqueta={tx('conductores.vista.primer_aviso_segundo_jefe')} valor={`${numero(insights.escalera.aviso1.valor)} / ${numero(insights.escalera.aviso2.valor)} / ${numero(insights.escalera.jefe.valor)}`} cifra={insights.escalera.aviso1} />
            {discrepancias !== null && (
              <FilaFuente tr={tr} etiqueta={tx('conductores.vista.chofer_vs_gps_sin_coincidir')} valor={numero(discrepancias)} cifra={{ rotulo: 'medido', fuente: tx('conductores.vista.validacion_de_ubicacion_de_cada') }} />
            )}
          </ul>
          {recortada && <p className="rv-cd__nota" data-tono="warn">{tx('conductores.vista.la_lectura_llego_a_su')}</p>}
        </Disclosure>
      </div>
    </Tarjeta>
  );
}
