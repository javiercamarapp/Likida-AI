// ═══════════════════════════════════════════════════════════════════════════
// EL RUNNER NIVEL 2 (0123) — la autonomía ACOTADA que Javier ordenó el
// 16-ago-2026, anulando el diferimiento del diseño del copiloto §4.
//
// EL ORQUESTADOR ES DETERMINISTA A PROPÓSITO — cero LLM en el despacho
// (la mitad determinista del mismo diseño: "las reglas calculan, el LLM
// redacta"). Quien gasta modelo es el AGENTE despachado, con su rol barato
// (models.ts `back_office`), y este módulo lo frena por CUATRO candados,
// todos fail-closed:
//   1. Kill switch global y por agente (interruptores 0110). Un agente
//      autónomo SIN kill switch declarado no corre — punto.
//   2. Opt-in `runner_habilitado` + estado 'vivo' + disparador 'cron'
//      (agente_definicion 0123) — apagable en la base sin deploy.
//   3. TECHO DE DINERO: presupuesto_dia_usd DECLARADO (NULL = no corre
//      solo) y reservado de forma atómica en el ledger central por tenant.
//      Sin tenant explícito o sin reserva durable, no se corre.
//   4. BACKPRESSURE: si la bandeja de aprobación ya acumula piezas sin
//      resolver, el runner no fabrica más — un humano que no aprueba es la
//      señal de parar, no de insistir.
//
// La SALIDA de todo agente del runner es la cola de aprobación — el runner
// jamás toca un canal de envío. El tope de ENVÍO diario vive aparte, en la
// única puerta de salida (cola.ts).
//
// Los cuatro candados son de DINERO y de SEGURIDAD. Aparte de ellos, y desde
// el 25-ago-2026, la vuelta trae un PRESUPUESTO DE TIEMPO (ver
// `MARGEN_RELOJ_MS` más abajo): no decide si un agente puede correr, decide si
// TODAVÍA CABE en la invocación. Lo que no cabe se dice; no se muere.
// ═══════════════════════════════════════════════════════════════════════════
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { estaApagado, INTERRUPTORES, type NombreInterruptor } from '../interruptores';
import { hoyMx } from '@/lib/formato';
import { LlmBudgetExceededError, createLlmBudget, type LlmBudget } from '@/lib/llm/budget';
import { redactarCorreoFrio } from './redactor';
import { correrAgenteFinanciero, esAgenteFinanciero } from './finanzas';
import { candidatosSinDossier, investigarProspecto } from './investigador';
import { correrSdr } from './sdr';
import { correrEnviador } from './enviador';
import { logger } from '@/lib/logger';

/** Piezas que una corrida del runner fabrica como máximo por agente. */
export function topePiezasPorCorrida(): number {
  const v = Number(process.env.LIKIDA_RUNNER_PIEZAS_POR_CORRIDA);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 5;
}

/** Pendientes en la bandeja a partir de los cuales el runner deja de
 *  fabricar (backpressure): aprobar es humano, y una bandeja desbordada es
 *  la señal de parar. */
export function topePendientesBandeja(): number {
  const v = Number(process.env.LIKIDA_RUNNER_TOPE_PENDIENTES);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 20;
}

/** Los cuatro del back office restante (0219). La lista se escribe AQUÍ como
 *  literal —y no importando `AGENTES_BACK_OFFICE`— por la misma razón que la
 *  de dirección: el módulo del motor se carga por import dinámico dentro de
 *  su rama, y un import estático para leer cuatro cadenas lo traería en cada
 *  vuelta del runner. `runner.test.ts` compara esta lista contra la del
 *  motor: si divergen, falla. */
const BACK_OFFICE_RESTANTE: readonly string[] = ['vigilante_calidad', 'documentacion', 'legal_compliance', 'talento'];

/** Los seis del departamento de éxito del cliente (0218). La lista se repite
 *  aquí como literal —en vez de importar `AGENTES_EXITO` de `./exito`— por lo
 *  mismo que la de dirección: importar el catálogo arrastraría el módulo
 *  entero al bundle del runner y la gracia del despacho es que solo se cargue
 *  cuando de verdad toca. La verdad de quién existe la manda `agente_definicion`. */
const AGENTES_EXITO_CLIENTE: readonly string[] = [
  'onboarding_cliente', 'exito_cliente', 'retencion',
  'cobranza_saas', 'soporte', 'atencion_faq',
];
type AgenteDeExito = 'onboarding_cliente' | 'exito_cliente' | 'retencion'
  | 'cobranza_saas' | 'soporte' | 'atencion_faq';

export interface AgenteDelRunner {
  agente: string;
  resultado: 'corrio' | 'saltado';
  motivo?: string;
  piezas?: number;
  saltados?: number;
  costoUsd?: number;
}

export interface ResultadoRunner {
  apagadoGlobal: boolean;
  agentes: AgenteDelRunner[];
  /** Los que NO alcanzaron turno porque el reloj de la corrida se agotó. La
   *  lista, no el conteo: el operador necesita saber CUÁLES se quedaron sin
   *  correr, no cuántos. Vacía en una vuelta que cupo entera. */
  saltadosPorReloj: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// EL PRESUPUESTO DE TIEMPO (alerta de prod 25-ago-2026, 18:46 — "Sin latido:
// runner hace 286 min").
//
// Con 34 agentes habilitados, la pasada de las 18:00 despachó ~15 EN SERIE y
// Vercel la mató en el `maxDuration` de 120 s: los agentes del final ni
// corrieron, y —lo grave— la ruta murió ANTES de `registrarLatido`, así que
// el orquestador quedó MUDO. Cuatro horas después la alerta de latido vencido
// fue la primera noticia. El mismo modo de falla que la cobranza global ya
// había resuelto (REND-C2/ESC-3): trabajo serial sin reloj bajo un
// `maxDuration` que nadie mira.
//
// La cura es la misma que allá: un vencimiento ÚNICO para toda la vuelta, que
// se consulta ANTES de despachar cada agente. Si no alcanza, se corta LIMPIO
// —los que faltan quedan dichos, no desaparecidos— y la ruta alcanza a
// escribir su latido `'parcial'`. Una pasada cortada con latido es
// infinitamente mejor que una pasada completa que muere muda.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que se le deja a la ruta para responder y ESCRIBIR EL LATIDO después
 *  del corte. 20 s: el latido es un upsert (tope de `acotada`, 8 s) más el
 *  `leerLatido` de la racha y el correo del tercer corte seguido. */
export const MARGEN_RELOJ_MS = 20_000;

/** El reloj por default cuando el llamador no impone uno: el `maxDuration`
 *  de 300 s del cron menos el margen. El cron pasa el suyo explícito —esta
 *  constante es la red para el copiloto y las pruebas. */
export const PLAZO_RUNNER_MS = 300_000 - MARGEN_RELOJ_MS;

/** Los agentes que GASTAN MODELO. Se despachan AL FINAL a propósito: si el
 *  reloj corta, lo que se sacrifica es lo caro y lo lento, no los partes
 *  deterministas (financieros, dirección, back office, éxito) que salen en
 *  milisegundos y son los que Javier lee cada mañana. Antes el orden era
 *  `ORDER BY id` —o sea, el alfabeto— y `atencion_faq` con `enriquecedor`
 *  encabezaban la vuelta comiéndose el reloj de los otros treinta. */
export function llamaAlModelo(agente: string): boolean {
  return agente === 'redactor' || agente === 'enriquecedor'
    || agente === 'sdr' || agente === 'atencion_faq';
}

/** El orden de despacho: baratos primero, caros al final, y DENTRO de cada
 *  grupo el orden estable que ya traía la consulta (`ORDER BY id`) — `sort`
 *  es estable por spec desde ES2019, así que dos vueltas con los mismos
 *  agentes despachan en el mismo orden. */
export function ordenarPorCosto<T extends { id: string }>(agentes: readonly T[]): T[] {
  return [...agentes].sort((a, b) => Number(llamaAlModelo(a.id)) - Number(llamaAlModelo(b.id)));
}

/** El gasto MEDIDO del agente hoy (día de México), USD. LANZA si la base no
 *  responde — el techo no se verifica a ciegas. */
export async function gastoDelDiaUsd(agente: string): Promise<number> {
  const diaMx = hoyMx();
  const inicioDia = new Date(`${diaMx}T00:00:00-06:00`).toISOString();
  const { data, error } = await acotada(supabaseAdmin()
    .from('agente_corrida')
    .select('costo_usd')
    .eq('agente', agente)
    .not('costo_usd', 'is', null)
    .gte('inicio', inicioDia)
    .limit(1000), 'runner.gasto_dia');
  if (error) throw new Error(`gastoDelDiaUsd: ${error.message}`);
  return ((data ?? []) as Array<{ costo_usd: unknown }>).reduce((s, f) => s + Number(f.costo_usd ?? 0), 0);
}

/** El lote del Redactor: fabrica hasta N piezas para prospectos en `nuevo`
 *  (los más viejos primero — los del SLA), cortando por la reserva/run central.
 *  Las guardas por prospecto (cadencia 48h, pieza pendiente, estado) viven
 *  DENTRO de redactarCorreoFrio — aquí solo se seleccionan candidatos. */
async function loteRedactor(budget: LlmBudget | null): Promise<{ piezas: number; saltados: number; costoUsd: number }> {
  const tope = topePiezasPorCorrida();
  // Overfetch ×4: varios candidatos rebotan en las guardas del redactor
  // (pieza pendiente, cadencia) y eso NO es fallo — es la guarda operando.
  const { data, error } = await acotada(supabaseAdmin()
    .from('prospecto')
    .select('id, vendedor:vendedor_id(nombre)')
    .is('duplicado_de', null)
    .eq('estado', 'nuevo')
    .order('created_at', { ascending: true })
    .limit(tope * 4), 'runner.candidatos');
  if (error) throw new Error(`loteRedactor.candidatos: ${error.message}`);
  const candidatos = (data ?? []) as Array<{ id: string; vendedor: { nombre?: string } | null }>;

  let piezas = 0, saltados = 0, costoUsd = 0;
  for (const c of candidatos) {
    if (piezas >= tope) break;
    if (budget && budget.reservadoRunUsd >= budget.maxRunUsd) break;
    try {
      // Sin budget = modo PLATAFORMA (c5-10): gasto de Likida, techo vigilado
      // por el runner contra el gasto medido del día — el mismo contrato que
      // investigador/SDR/enviador.
      const r = await redactarCorreoFrio(c.id, c.vendedor?.nombre?.trim() || 'Javier', 'cron', budget ? {
        tenantId: budget.tenantId,
        budget,
      } : { plataforma: true });
      piezas += 1;
      costoUsd += r.costoUsd;
    } catch (e) {
      // La RPC central ya hizo la decisión atómica. No se trata como un
      // prospecto inválido ni se sigue fabricando: el techo es de la corrida.
      if (e instanceof LlmBudgetExceededError) break;
      // Guarda legítima o fallo puntual: se cuenta y se sigue — un prospecto
      // atorado no puede parar el lote entero. El detalle ya quedó en la
      // corrida/log del redactor.
      saltados += 1;
      logger.info('runner.redactor.saltado', { prospecto: c.id, motivo: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }
  return { piezas, saltados, costoUsd };
}

/**
 * UNA vuelta del runner: despacha cada agente habilitado que pase los cuatro
 * candados. Cada agente falla POR SU LADO — un agente roto no tumba a los
 * demás, y el motivo de cada salto queda dicho.
 */
export async function correrRunner(
  /**
   * M30 (auditoría 18): acotar la vuelta a UN agente. El copiloto enseñaba
   * "Voy a ejecutar `redactor`" y despachaba a todos los habilitados. Sin
   * argumento sigue siendo la vuelta completa del cron.
   */
  soloAgente?: string,
  /** Tenant autenticado/explicitamente asignado que paga esta corrida.
   *  `null`/ausente bloquea al Redactor; nunca se usa un env global. */
  budgetTenantId?: string | null,
  /** El presupuesto de TIEMPO de esta vuelta. `venceEn` es el instante
   *  (epoch ms) a partir del cual ya no se despacha a nadie más — el cron le
   *  pasa su `maxDuration` menos `MARGEN_RELOJ_MS`. */
  opts: { venceEn?: number } = {},
): Promise<ResultadoRunner> {
  if (await estaApagado('global')) {
    return { apagadoGlobal: true, agentes: [], saltadosPorReloj: [] };
  }

  const { data, error } = await acotada(supabaseAdmin()
    .from('agente_definicion')
    .select('id, presupuesto_dia_usd')
    .eq('estado', 'vivo')
    .eq('runner_habilitado', true)
    .eq('disparador', 'cron')
    .order('id'), 'runner.agentes');
  if (error) throw new Error(`correrRunner: ${error.message}`);
  const habilitados = ordenarPorCosto(((data ?? []) as Array<{ id: string; presupuesto_dia_usd: number | null }>)
    .filter((a) => !soloAgente || a.id === soloAgente));

  const venceEn = opts.venceEn ?? Date.now() + PLAZO_RUNNER_MS;
  const agentes: AgenteDelRunner[] = [];
  const saltadosPorReloj: string[] = [];
  for (let i = 0; i < habilitados.length; i++) {
    const a = habilitados[i];
    // Candado 0 — EL RELOJ. Se pregunta ANTES de despachar, no después: la
    // gracia es que el corte deje a la ruta tiempo de escribir el latido. Los
    // que faltan se dicen uno por uno —con nombre— en vez de desaparecer con
    // la invocación, que es exactamente lo que pasó el 25-ago.
    if (Date.now() >= venceEn) {
      for (const pendiente of habilitados.slice(i)) {
        saltadosPorReloj.push(pendiente.id);
        agentes.push({
          agente: pendiente.id,
          resultado: 'saltado',
          motivo: 'saltado por reloj — la vuelta se quedó sin presupuesto de tiempo; le toca en la próxima pasada',
        });
      }
      logger.warn('runner.corte_por_reloj', { saltados: saltadosPorReloj.length, desde: a.id });
      break;
    }

    // Candado 1 — el kill switch. Sin interruptor declarado NO corre: un
    // agente autónomo que no se puede apagar no existe en este producto.
    const interruptor = `agente:${a.id}`;
    if (!(INTERRUPTORES as readonly string[]).includes(interruptor)) {
      agentes.push({ agente: a.id, resultado: 'saltado', motivo: 'sin kill switch declarado (interruptores.ts + CHECK 0110) — un autónomo inapagable no corre' });
      continue;
    }
    try {
      if (await estaApagado(interruptor as NombreInterruptor)) {
        agentes.push({ agente: a.id, resultado: 'saltado', motivo: 'apagado desde Observabilidad/⌘K' });
        continue;
      }
    } catch {
      agentes.push({ agente: a.id, resultado: 'saltado', motivo: 'no se pudo leer el interruptor — fail closed' });
      continue;
    }

    // Candado 3 — el techo de dinero, declarado y medido.
    if (a.presupuesto_dia_usd === null || a.presupuesto_dia_usd <= 0) {
      agentes.push({ agente: a.id, resultado: 'saltado', motivo: 'sin presupuesto_dia_usd declarado — el runner no corre agentes sin techo' });
      continue;
    }
    // Candado 4 — backpressure de la bandeja (solo agentes que encolan).
    if (a.id === 'redactor') {
      const { count, error: errPend } = await supabaseAdmin()
        .from('cola_aprobacion')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'pendiente')
        .eq('tipo', 'correo_frio');
      if (errPend || typeof count !== 'number') {
        agentes.push({ agente: a.id, resultado: 'saltado', motivo: 'no se pudo leer la bandeja — fail closed' });
        continue;
      }
      if (count >= topePendientesBandeja()) {
        agentes.push({ agente: a.id, resultado: 'saltado', motivo: `bandeja con ${count} piezas sin resolver — aprobar es humano; el runner no fabrica encima` });
        continue;
      }

      // AUDITORÍA FABLE CICLO 5 (c5-10): sin tenant explícito, la corrida es
      // de PLATAFORMA (gasto de Likida) — antes este camino era "saltado —
      // fail closed" en toda pasada del cron y del copiloto, así que ninguna
      // pieza se fabricaba sola y la máquina completa dependía del botón
      // manual. El techo sigue: gasto MEDIDO del día vs presupuesto
      // declarado, el mismo candado que investigador/SDR/enviador.
      if (!budgetTenantId) {
        try {
          const gastado = await gastoDelDiaUsd(a.id);
          if (gastado >= a.presupuesto_dia_usd) {
            agentes.push({ agente: a.id, resultado: 'saltado', motivo: `techo diario alcanzado (${gastado.toFixed(2)} de ${a.presupuesto_dia_usd} USD)` });
            continue;
          }
        } catch (e) {
          agentes.push({ agente: a.id, resultado: 'saltado', motivo: `no se pudo leer el gasto del día — fail closed (${e instanceof Error ? e.message.slice(0, 120) : 'error'})` });
          continue;
        }
      }

      try {
        const budget = budgetTenantId
          ? createLlmBudget(budgetTenantId, randomUUID(), { maxTenantDailyUsd: a.presupuesto_dia_usd })
          : null;
        const r = await loteRedactor(budget);
        agentes.push({ agente: a.id, resultado: 'corrio', ...r });
      } catch (e) {
        agentes.push({ agente: a.id, resultado: 'saltado', motivo: e instanceof Error ? e.message.slice(0, 200) : 'fallo del lote' });
      }
      continue;
    }

    // Los 4 financieros (0215): deterministas, gasto de modelo $0 (el techo
    // declarado queda como candado formal). Su backpressure vive DENTRO del
    // motor — un parte del periodo sin resolver frena al siguiente — y su
    // salida es la misma bandeja que la del Redactor.
    if (esAgenteFinanciero(a.id)) {
      try {
        const r = await correrAgenteFinanciero(a.id, 'cron');
        agentes.push({ agente: a.id, resultado: 'corrio', piezas: r.piezas, costoUsd: 0, ...(r.motivo ? { motivo: r.motivo } : {}) });
      } catch (e) {
        agentes.push({ agente: a.id, resultado: 'saltado', motivo: e instanceof Error ? e.message.slice(0, 200) : 'fallo de la corrida financiera' });
      }
      continue;
    }

    // ── Dirección (0216): los cuatro reporteros deterministas ──────────────
    // Import dinámico a propósito: el módulo arrastra los lectores de /admin
    // (negocio, escalaciones, salud) y solo se paga cuando de verdad se
    // despacha un agente de dirección — no en cada carga del runner.
    if (['kpi_whatsapp', 'desempeno_startup', 'orquestador', 'orquestador_semanal'].includes(a.id)) {
      try {
        const { correrAgenteDireccion } = await import('../direccion/reportes');
        const r = await correrAgenteDireccion(a.id as 'kpi_whatsapp' | 'desempeno_startup' | 'orquestador' | 'orquestador_semanal');
        agentes.push({ agente: a.id, resultado: r.resultado, motivo: r.motivo, piezas: r.piezas, costoUsd: r.costoUsd });
      } catch (e) {
        agentes.push({ agente: a.id, resultado: 'saltado', motivo: e instanceof Error ? e.message.slice(0, 200) : 'fallo del motor de dirección' });
      }
      continue;
    }

    // ── EL BACK OFFICE RESTANTE (0219) — vigilante, documentación, legal
    // y talento. Deterministas (gasto de modelo $0), pero el techo se mide
    // igual contra el gasto REAL del día: si algún día uno de ellos redacta
    // con modelo, el candado ya está puesto y no hay que acordarse de ponerlo.
    // Fail closed: si el gasto no se puede leer, el agente no corre.
    // Import dinámico por la misma razón que el de dirección: el módulo
    // arrastra los lectores legales y de la cola, y solo se paga cuando de
    // verdad se despacha uno de estos cuatro.
    if (BACK_OFFICE_RESTANTE.includes(a.id)) {
      try {
        const gastado = await gastoDelDiaUsd(a.id);
        if (gastado >= a.presupuesto_dia_usd) {
          agentes.push({ agente: a.id, resultado: 'saltado', motivo: `techo diario alcanzado (${gastado.toFixed(2)} de ${a.presupuesto_dia_usd} USD)` });
          continue;
        }
      } catch (e) {
        agentes.push({ agente: a.id, resultado: 'saltado', motivo: `no se pudo leer el gasto del día — fail closed (${e instanceof Error ? e.message.slice(0, 120) : 'error'})` });
        continue;
      }
      try {
        const { correrAgenteBackOffice, esAgenteBackOffice } = await import('./backoffice');
        // El estrechamiento de verdad lo hace el predicado del motor, no la
        // lista literal de arriba: si alguna vez divergen, aquí se ve.
        if (!esAgenteBackOffice(a.id)) {
          agentes.push({ agente: a.id, resultado: 'saltado', motivo: 'la lista del runner y la del motor de back office divergen — no se despacha a ciegas' });
          continue;
        }
        const r = await correrAgenteBackOffice(a.id, 'cron');
        agentes.push({ agente: a.id, resultado: 'corrio', piezas: r.piezas, costoUsd: 0, ...(r.motivo ? { motivo: r.motivo } : {}) });
      } catch (e) {
        agentes.push({ agente: a.id, resultado: 'saltado', motivo: e instanceof Error ? e.message.slice(0, 200) : 'fallo del motor de back office' });
      }
      continue;
    }

    // ── ÉXITO DEL CLIENTE (0218): los seis de la flota que ya firmó ───────
    // Cinco son deterministas (gasto de modelo $0, el techo declarado es el
    // candado formal); `atencion_faq` SÍ redacta con LLM, así que se le
    // aplica el mismo candado de gasto MEDIDO que a la máquina de
    // prospección. Import dinámico por la misma razón que dirección: el
    // módulo arrastra los lectores de /admin y, en la rama del FAQ, el corpus
    // de normas y el cliente del modelo — no se paga en cada carga del runner.
    if (AGENTES_EXITO_CLIENTE.includes(a.id)) {
      if (a.id === 'atencion_faq') {
        try {
          const gastado = await gastoDelDiaUsd(a.id);
          if (gastado >= a.presupuesto_dia_usd) {
            agentes.push({ agente: a.id, resultado: 'saltado', motivo: `techo diario alcanzado (${gastado.toFixed(2)} de ${a.presupuesto_dia_usd} USD)` });
            continue;
          }
        } catch (e) {
          agentes.push({ agente: a.id, resultado: 'saltado', motivo: `no se pudo leer el gasto del día — fail closed (${e instanceof Error ? e.message.slice(0, 120) : 'error'})` });
          continue;
        }
      }
      try {
        const { correrAgenteExito } = await import('./exito');
        const r = await correrAgenteExito(a.id as AgenteDeExito, 'cron');
        agentes.push({ agente: a.id, resultado: r.resultado, motivo: r.motivo, piezas: r.piezas, costoUsd: r.costoUsd });
      } catch (e) {
        agentes.push({ agente: a.id, resultado: 'saltado', motivo: e instanceof Error ? e.message.slice(0, 200) : 'fallo del motor de éxito del cliente' });
      }
      continue;
    }

    // ── LA MÁQUINA DE PROSPECCIÓN (0217) — investigador, SDR y enviador ──
    // Los tres corren para LIKIDA (tenant null), así que su techo de dinero
    // no pasa por el ledger por-tenant del Redactor: se compara el gasto
    // MEDIDO del día (agente_corrida.costo_usd, que sus corridas escriben)
    // contra el presupuesto declarado. Menos fino que la reserva atómica —
    // dos vueltas simultáneas podrían leer el mismo gasto — pero el cron
    // corre cada 4 horas y cada corrida anota su costo: la ventana real es
    // minutos, y el fallo es visible en la ficha, no silencioso. Fail
    // closed: si el gasto del día no se puede leer, el agente no corre.
    if (a.id === 'enriquecedor' || a.id === 'sdr' || a.id === 'enviador') {
      try {
        const gastado = await gastoDelDiaUsd(a.id);
        if (gastado >= a.presupuesto_dia_usd) {
          agentes.push({ agente: a.id, resultado: 'saltado', motivo: `techo diario alcanzado (${gastado.toFixed(2)} de ${a.presupuesto_dia_usd} USD)` });
          continue;
        }
      } catch (e) {
        agentes.push({ agente: a.id, resultado: 'saltado', motivo: `no se pudo leer el gasto del día — fail closed (${e instanceof Error ? e.message.slice(0, 120) : 'error'})` });
        continue;
      }
      try {
        if (a.id === 'enriquecedor') {
          const ids = await candidatosSinDossier(topePiezasPorCorrida());
          let piezas = 0, saltados = 0, costoUsd = 0;
          for (const id of ids) {
            try {
              const r = await investigarProspecto(id, 'cron');
              piezas += 1;
              costoUsd += r.costoUsd;
            } catch (e) {
              saltados += 1;
              logger.info('runner.investigador.saltado', { prospecto: id, motivo: e instanceof Error ? e.message.slice(0, 160) : String(e) });
            }
          }
          agentes.push({ agente: a.id, resultado: 'corrio', piezas, saltados, costoUsd });
        } else if (a.id === 'sdr') {
          const r = await correrSdr('cron', topePiezasPorCorrida());
          agentes.push({ agente: a.id, resultado: 'corrio', piezas: r.piezas, saltados: r.saltados, costoUsd: r.costoUsd });
        } else {
          const r = await correrEnviador('cron', topePiezasPorCorrida() * 2);
          agentes.push({ agente: a.id, resultado: 'corrio', piezas: r.piezasEnviadas, saltados: r.saltadas, costoUsd: 0 });
        }
      } catch (e) {
        agentes.push({ agente: a.id, resultado: 'saltado', motivo: e instanceof Error ? e.message.slice(0, 200) : 'fallo del lote' });
      }
      continue;
    }

    // Un agente habilitado sin motor despachable: se dice, no se finge.
    agentes.push({ agente: a.id, resultado: 'saltado', motivo: 'sin motor despachable en el runner todavía — habilitarlo aquí exige su rama de despacho' });
  }

  return { apagadoGlobal: false, agentes, saltadosPorReloj };
}
