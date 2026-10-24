// ═══════════════════════════════════════════════════════════════════════════
// EL SDR (C8) — los seguimientos +3/+7 de un correo de campaña que nadie
// contestó. Máximo DOS por prospecto, y las tres señales que lo detienen en
// seco, cada una verificada contra la base antes de fabricar:
//
//   · una RESPUESTA (dirección 'respuesta' en el historial 0118) — el humano
//     toma la conversación, el SDR jamás contesta por él;
//   · un REBOTE o una QUEJA (entrega_estado del webhook 0124) — insistirle a
//     una dirección que rebotó quema el dominio;
//   · la propia cadencia: la primera salida marca el reloj (+3 y +7 días),
//     y dos seguimientos son el final — lo que sigue es del Vigía, no de
//     otro correo.
//
// El SDR NO envía: fabrica la pieza (`correo_seguimiento`) a la cola de
// aprobación, y la puerta de salida sigue siendo el Enviador con todos sus
// candados (tope diario, cadencia atómica 48h, lista de bajas).
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { DatoInvalido } from '../errores';
import { estaApagado } from '../interruptores';
import { generateResponse } from '@/lib/llm/openrouter';
import { encolarPieza, verificarFormatoCampana } from './cola';
import { registrarCorrida, type DisparoCorrida } from './corridas';
import { primerNombreDelContacto, sustituirMarcador } from './redactor';
import { logger } from '@/lib/logger';

/** Días desde la PRIMERA salida para cada seguimiento. */
export const CADENCIA_SDR_DIAS = [3, 7] as const;

const SYSTEM = `Eres el SDR de Likida (liquidación de viajes de flotas de carga en México). Escribes el SEGUIMIENTO breve de un correo que ya salió y nadie contestó.

REGLAS:
- Máximo 3 líneas. Asunto de máximo 6 palabras que retome el tema, sin signos de admiración.
- Referencia honesta al correo anterior ("le escribí hace unos días sobre la liquidación de viajes") sin reprochar el silencio.
- Termina con UNA pregunta de agenda concreta ("¿le vienen bien 15 minutos esta semana?").
- Si el dossier trae un Contacto, usa EXACTAMENTE el token {{NOMBRE}} donde iría su nombre de pila; si dice "no capturado", saluda sin nombre.
- PROHIBIDO: cifras nuevas, promesas nuevas, datos que no estén en el dossier, la palabra "recordatorio", los guiones largos (—), decir "clientes reales", y nombrar a NINGÚN prospecto o cliente por su nombre (AGB-2: si mencionas tracción, la única frase permitida es "en pláticas con transportistas del centro y norte del país").
- Español mexicano directo, sin emojis.

FORMATO DE SALIDA (exacto):
**Asunto:** ...
[cuerpo]`;

export interface ResultadoSdr {
  candidatos: number;
  piezas: number;
  saltados: number;
  /** AGB-9 (auditoría 24): `null` = al menos una llamada al modelo no trajo
   *  `usage` medible — el costo es DESCONOCIDO, no cero. Antes `0` se
   *  guardaba como NULL en la base por `costoUsd || undefined` sin que este
   *  tipo lo admitiera, y el runner sumaba ceros contra un techo que nunca
   *  se enteraba de que había gasto real sin medir (28 de 28 corridas). */
  costoUsd: number | null;
  /** Los candidatos que el RELOJ de la vuelta dejó sin turno (c7-1). 0 cuando
   *  el lote cupo entero o cuando el llamador no impuso reloj. */
  sinTurno: number;
}

/** Falló DESPUÉS de pagar la llamada al modelo: lleva el costo para que la corrida lo contabilice (A37-S28-04). */
class SeguimientoFallido extends Error {
  constructor(public causa: unknown, public costoUsd: number, public noMedido: boolean) {
    super(causa instanceof Error ? causa.message : String(causa));
  }
}

interface CandidatoSdr {
  id: string;
  empresa: string;
  contacto_nombre: string | null;
  numeroSeguimiento: 1 | 2;
}

/** A37-S28-02: tamaño de la página del cursor y tope de filas que UNA búsqueda puede escanear. Un tope
 *  explícito, no un `while(true)`: la cola de `contactado` puede ser larga. */
const PAGINA_SEGUIMIENTO = 50;
const TOPE_FILAS_ESCANEADAS_SDR = 2_000;
/** PostgREST corta en silencio en ~1,000 filas: una lectura que llega al tope pudo quedar TRUNCADA, y una
 *  cadencia decidida sobre un historial truncado manda correos de más (se perdería una `respuesta`). */
const TOPE_FILAS_HISTORIAL = 1_000;

/** Elige los prospectos que TOCAN hoy: contactados, sin respuesta, sin
 *  rebote/queja, con la primera salida hace ≥3 (o ≥7) días y 1 (o 2) salidas
 *  en el historial. Exportada para su prueba. LANZA ante lecturas caídas —
 *  una cadencia decidida a ciegas manda correos de más.
 *
 *  A37-S28-02: pagina por cursor `(updated_at, id)` y evalúa cada página con
 *  TRES lecturas en lote (no dos por prospecto). Antes tomaba solo las
 *  `limite*5` filas más viejas: tras ~25 prospectos que terminaron la cadencia,
 *  respondieron o rebotaron y siguen `contactado` (solo el vendedor cambia ese
 *  estado), la ventana se llenaba de descartes y ningún prospecto más nuevo
 *  recibía seguimiento jamás. */
export async function candidatosDeSeguimiento(limite: number, venceEn?: number): Promise<CandidatoSdr[]> {
  const elegidos: CandidatoSdr[] = [];
  let cursor: { updatedAt: string; id: string } | null = null;
  let escaneadas = 0;
  while (elegidos.length < limite && escaneadas < TOPE_FILAS_ESCANEADAS_SDR) {
    // ── EL RELOJ, TAMBIÉN EN LA BÚSQUEDA (c7-1) ──────────────────────────────
    // La búsqueda cuesta consultas; con la cola llena de descartes se gastaban
    // ANTES de que el reloj del lote preguntara siquiera. Cortar aquí es seguro
    // y no necesita `sinTurno` propio: esta función SOLO LEE, y devolver menos
    // candidatos es el caso normal que el llamador ya maneja (`correrSdr` cuenta
    // el corte para el latido).
    if (venceEn !== undefined && Date.now() >= venceEn) {
      logger.warn('sdr.busqueda.corte_por_reloj', { encontrados: elegidos.length });
      break;
    }
    let q = supabaseAdmin()
      .from('prospecto')
      .select('id, empresa, contacto_nombre, updated_at')
      .is('duplicado_de', null)
      .eq('estado', 'contactado')
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGINA_SEGUIMIENTO);
    // Keyset (regla del repo, `pg.ts`): estrictamente DESPUÉS del último visto.
    if (cursor) q = q.or(`updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${cursor.id})`);
    const { data, error } = await acotada(q, 'sdr.candidatos');
    if (error) throw new Error(`candidatosDeSeguimiento: ${error.message}`);
    const pagina = (data ?? []) as Array<{ id: string; empresa: string; contacto_nombre: string | null; updated_at: string }>;
    if (pagina.length === 0) break; // el cursor alcanzó el final
    escaneadas += pagina.length;
    const ids = pagina.map((f) => f.id);

    const { data: hist, error: errHist } = await acotada(supabaseAdmin()
      .from('prospecto_contacto')
      .select('prospecto_id, direccion, canal, ocurrio_en')
      .in('prospecto_id', ids)
      .in('direccion', ['respuesta', 'salida'])
      .order('ocurrio_en', { ascending: true })
      .order('id', { ascending: true })
      .limit(TOPE_FILAS_HISTORIAL), 'sdr.historial');
    if (errHist) throw new Error(`candidatosDeSeguimiento.historial: ${errHist.message}`);
    const filasHist = (hist ?? []) as Array<{ prospecto_id: string; direccion: string; canal?: string; ocurrio_en: string }>;
    if (filasHist.length >= TOPE_FILAS_HISTORIAL) {
      throw new Error('candidatosDeSeguimiento.historial: la lectura llegó al tope y pudo truncarse — no se decide la cadencia a ciegas');
    }

    // Rebote/queja de CUALQUIER pieza del prospecto lo saca de la cadencia.
    const { data: malas, error: errMalas } = await acotada(supabaseAdmin()
      .from('cola_aprobacion')
      .select('prospecto_id')
      .in('prospecto_id', ids)
      .in('entrega_estado', ['rebotado', 'queja'])
      .order('id', { ascending: true })
      .limit(TOPE_FILAS_HISTORIAL), 'sdr.entrega');
    if (errMalas) throw new Error(`candidatosDeSeguimiento.entrega: ${errMalas.message}`);
    const filasMalas = (malas ?? []) as Array<{ prospecto_id: string }>;
    if (filasMalas.length >= TOPE_FILAS_HISTORIAL) {
      throw new Error('candidatosDeSeguimiento.entrega: la lectura llegó al tope y pudo truncarse — no se decide la cadencia a ciegas');
    }
    const conRebote = new Set(filasMalas.map((m) => m.prospecto_id));
    const contestaron = new Set(filasHist.filter((x) => x.direccion === 'respuesta').map((x) => x.prospecto_id));
    const salidasDe = new Map<string, string[]>();
    for (const x of filasHist) {
      if (x.direccion !== 'salida') continue;
      // A37-S28-06: solo cuenta una salida POR CORREO. Una llamada, un LinkedIn o una visita registrados como
      // «salida» no son un correo enviado: el seguimiento haría referencia a un correo que nunca se mandó.
      // (Las RESPUESTAS de cualquier canal sí detienen la cadencia: un humano ya está conversando.)
      if (x.canal !== 'correo') continue;
      const l = salidasDe.get(x.prospecto_id);
      if (l) l.push(x.ocurrio_en); else salidasDe.set(x.prospecto_id, [x.ocurrio_en]);
    }

    for (const f of pagina) {
      if (elegidos.length >= limite) break;
      if (contestaron.has(f.id)) continue;      // contestó: humano al volante
      if (conRebote.has(f.id)) continue;
      const salidas = salidasDe.get(f.id) ?? [];
      if (salidas.length === 0 || salidas.length > CADENCIA_SDR_DIAS.length) continue;
      const primeraSalida = new Date(salidas[0]).getTime();
      const diasDesde = (Date.now() - primeraSalida) / 86_400_000;
      const objetivoDias = CADENCIA_SDR_DIAS[salidas.length - 1];
      if (diasDesde < objetivoDias) continue;
      elegidos.push({
        id: f.id, empresa: f.empresa, contacto_nombre: f.contacto_nombre,
        numeroSeguimiento: salidas.length as 1 | 2,
      });
    }

    const ultima = pagina[pagina.length - 1];
    cursor = { updatedAt: ultima.updated_at, id: ultima.id };
    if (pagina.length < PAGINA_SEGUIMIENTO) break; // página parcial: no hay más filas
  }
  return elegidos;
}

/** Fabrica el seguimiento de UN candidato y lo encola. AGB-9: devuelve
 *  también si el costo vino MEDIDO — `noMedido` (c7-11) significa que el
 *  proveedor omitió `usage` y `cost` es la RESERVA (una cota), no lo gastado
 *  de verdad; guardarlo como cifra dejaría ciego al techo diario. */
async function fabricarSeguimiento(c: CandidatoSdr): Promise<{ costoUsd: number; noMedido: boolean }> {
  // Pieza pendiente del prospecto = no se fabrica encima (misma guarda que
  // el Redactor: la bandeja no se desborda con duplicados).
  const { data: pend, error: errPend } = await supabaseAdmin()
    .from('cola_aprobacion').select('id')
    .eq('prospecto_id', c.id).eq('estado', 'pendiente').limit(1);
  if (errPend) throw new DatoInvalido('No se pudo verificar la cola — reintenta.');
  if ((pend ?? []).length > 0) throw new DatoInvalido('Ya hay una pieza pendiente de este prospecto.');

  // A37-S28-03: una pieza `correo_seguimiento` de ESTE paso que ya existe en cualquier estado (aprobada pero aún
  // sin enviar por el tope/cadencia del Enviador, ya enviada, o RECHAZADA por un humano) bloquea una nueva: antes
  // solo miraba `pendiente`, y un seguimiento aprobado-sin-enviar se fabricaba otra vez (salían dos), y uno
  // rechazado se regeneraba en cada vuelta. La carrera de dos corridas la arbitra el índice único de la 0904.
  const { data: previas, error: errPrevias } = await supabaseAdmin()
    .from('cola_aprobacion').select('estado, fuentes')
    .eq('prospecto_id', c.id).eq('tipo', 'correo_seguimiento')
    .in('estado', ['pendiente', 'aprobado', 'rechazado'])
    .order('id', { ascending: true })
    .limit(20);
  if (errPrevias) throw new DatoInvalido('No se pudo verificar los seguimientos previos — reintenta.');
  const delPaso = ((previas ?? []) as Array<{ estado: string; fuentes: Record<string, unknown> | null }>)
    .find((f) => Number(f.fuentes?.seguimiento) === c.numeroSeguimiento);
  if (delPaso) throw new DatoInvalido(`Ya existe un seguimiento ${c.numeroSeguimiento} de este prospecto (${delPaso.estado}) — no se fabrica otro.`);

  const primerNombre = primerNombreDelContacto(c.contacto_nombre);
  const r = await generateResponse({
    role: 'back_office',
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `DOSSIER:\nEmpresa: ${c.empresa}\n${primerNombre ? 'Contacto: {{NOMBRE}}' : 'Contacto: no capturado'}\nSeguimiento número: ${c.numeroSeguimiento} de ${CADENCIA_SDR_DIAS.length}\n(No hay más hechos verificados. Lo que no esté aquí, NO existe.)`,
    }],
    maxTokens: 400,
    temperature: 0.4,
  });
  // A37-S28-04: desde aquí el modelo YA se cobró. Si la validación o el encolado fallan, el costo viaja en la
  // excepción para que `correrSdr` lo sume: antes se perdía y el techo diario nunca se enteraba.
  try {
    const asunto = r.text.match(/\*\*Asunto:\*\*\s*(.+)/i)?.[1]?.trim();
    const cuerpo = r.text.split(/\*\*Asunto:\*\*.*\n/i)[1]?.trim();
    if (!asunto || !cuerpo) throw new DatoInvalido('El SDR devolvió una salida ilegible — no se encoló nada.');
    // c5-14: el verificador estructural corre sobre el TEXTO FINAL — asunto
    // incluido (el del SDR sale tal cual) y DESPUÉS de sustituir el nombre: la
    // verificación previa miraba solo el cuerpo crudo y un guion largo en el
    // subject salía igual.
    const tituloFinal = sustituirMarcador(asunto, primerNombre).slice(0, 120);
    const cuerpoFinal = sustituirMarcador(cuerpo, primerNombre);
    verificarFormatoCampana(tituloFinal);
    verificarFormatoCampana(cuerpoFinal);
    await encolarPieza({
      tipo: 'correo_seguimiento', prioridad: 'normal', agente: 'sdr',
      prospectoId: c.id,
      titulo: tituloFinal,
      cuerpo: cuerpoFinal,
      fuentes: { seguimiento: c.numeroSeguimiento, de: CADENCIA_SDR_DIAS.length },
    });
  } catch (e) {
    throw new SeguimientoFallido(e, r.cost, Boolean(r.noMedido));
  }
  return { costoUsd: r.cost, noMedido: Boolean(r.noMedido) };
}

/** UNA corrida del SDR (la llama el runner). */
export async function correrSdr(
  disparo: DisparoCorrida = 'cron',
  limite = 5,
  /** EL RELOJ DE LA VUELTA (epoch ms), cuando el llamador impone uno. Ver la
   *  nota del `for`. Sin él el lote corre completo, como siempre. */
  venceEn?: number,
): Promise<ResultadoSdr> {
  const inicio = new Date();
  if (await estaApagado('agente:sdr')) {
    throw new DatoInvalido('El SDR está apagado — se enciende desde /admin/observabilidad o ⌘K.');
  }
  const candidatos = await candidatosDeSeguimiento(limite, venceEn);
  // EL CORTE DE LA BÚSQUEDA NO PUEDE SER MUDO. Si el reloj se agotó DENTRO de
  // `candidatosDeSeguimiento`, la lista vuelve corta —o vacía—, y entonces el
  // `for` de abajo o no entra nunca o corta en su primera vuelta con
  // `sinTurno = candidatos.length`. Con la lista vacía eso da CERO, o sea un
  // `resultado: 'corrio', piezas: 0, sinTurno: 0`: indistinguible de «no había
  // a quién darle seguimiento hoy», que es el estado normal y sano. Sería un
  // corte silencioso —el latido diría `'ok'`— y un corte silencioso es peor que
  // no cortar, porque el runner reportaría una pasada limpia dejando trabajo sin
  // hacer. Así que se pregunta la hora AQUÍ, entre la búsqueda y el lote, y el
  // piso de 1 deja constancia de que la vuelta se quedó a medias aunque no haya
  // un candidato concreto que nombrar.
  const busquedaCortada = venceEn !== undefined && Date.now() >= venceEn;
  // AGB-9: `null` es PEGAJOSO (ARQ-2) — una sola llamada sin medir vuelve
  // incierta la corrida entera; sumarle un número con `+=` la convertiría en
  // cero, que es justo el bug que dejaba 28 de 28 corridas con costo NULL sin
  // que el runner se enterara de que había gasto real sin medir.
  let piezas = 0, saltados = 0, costoUsd: number | null = 0, sinTurno = busquedaCortada ? Math.max(1, candidatos.length) : 0;
  for (let i = 0; i < candidatos.length; i++) {
    // ── EL RELOJ, ADENTRO DEL MOTOR (auditoría ciclo 7, c7-1) ───────────────
    // El SDR gasta modelo (`llamaAlModelo` lo tiene en la lista de caros) y
    // este `for` iteraba hasta el final sin mirar nada más que su propio
    // límite. Es el mismo modo de falla que mató al runner el 25-ago-2026 y el
    // 28-ago-2026 dentro del lote del Redactor: Vercel corta la función DENTRO
    // del bucle y la ruta no alcanza a escribir su latido. Se pregunta ANTES
    // de cada candidato, no después, porque lo que se protege es el tiempo de
    // latir. Lo que no alcanzó turno se DICE en `sinTurno` — no desaparece.
    if (venceEn !== undefined && Date.now() >= venceEn) {
      sinTurno = candidatos.length - i;
      logger.warn('sdr.corte_por_reloj', { sinTurno, piezas, saltados });
      break;
    }
    const c = candidatos[i];
    try {
      const r = await fabricarSeguimiento(c);
      piezas += 1;
      if (r.noMedido) {
        costoUsd = null;
        logger.warn('sdr.costo_no_medido', { prospecto: c.id });
      } else if (costoUsd !== null) {
        costoUsd = costoUsd + r.costoUsd;
      }
    } catch (e) {
      saltados += 1;
      if (e instanceof SeguimientoFallido) {
        // A37-S28-04: la llamada se pagó aunque la pieza se descartara.
        if (e.noMedido) costoUsd = null;
        else if (costoUsd !== null) costoUsd = costoUsd + e.costoUsd;
      }
      logger.info('sdr.saltado', { prospecto: c.id, motivo: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }
  await registrarCorrida(null, 'sdr', {
    inicio, fin: new Date(), estado: 'ok', disparo,
    tareasHechas: piezas, tareasTotal: candidatos.length,
    resumen: { candidatos: candidatos.length, piezas, saltados, sinTurno },
    costoUsd,
  });
  return { candidatos: candidatos.length, piezas, saltados, costoUsd, sinTurno };
}
