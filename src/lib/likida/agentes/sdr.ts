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

interface CandidatoSdr {
  id: string;
  empresa: string;
  contacto_nombre: string | null;
  numeroSeguimiento: 1 | 2;
}

/** Elige los prospectos que TOCAN hoy: contactados, sin respuesta, sin
 *  rebote/queja, con la primera salida hace ≥3 (o ≥7) días y 1 (o 2) salidas
 *  en el historial. Exportada para su prueba. LANZA ante lecturas caídas —
 *  una cadencia decidida a ciegas manda correos de más. */
export async function candidatosDeSeguimiento(limite: number, venceEn?: number): Promise<CandidatoSdr[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('prospecto')
    .select('id, empresa, contacto_nombre')
    .is('duplicado_de', null)
    .eq('estado', 'contactado')
    .order('updated_at', { ascending: true })
    .limit(limite * 5), 'sdr.candidatos');
  if (error) throw new Error(`candidatosDeSeguimiento: ${error.message}`);
  const filas = (data ?? []) as Array<{ id: string; empresa: string; contacto_nombre: string | null }>;

  const elegidos: CandidatoSdr[] = [];
  for (const f of filas) {
    if (elegidos.length >= limite) break;
    // ── EL RELOJ, TAMBIÉN EN LA BÚSQUEDA (c7-1) ──────────────────────────────
    // El `for` de `correrSdr` ya preguntaba la hora al FABRICAR, pero la
    // BÚSQUEDA que lo alimenta no la preguntaba nunca — y cuesta: la
    // sobre-lectura es ×5 (25 filas para 5 candidatos) y cada fila son DOS idas
    // a la base (el historial de contactos y la revisión de rebote/queja). Con
    // la cola llena de prospectos que ya contestaron o ya rebotaron, esas 50
    // consultas se gastan enteras ANTES de que el reloj del lote llegue
    // siquiera a preguntar por primera vez. Es el mismo hueco que la #158 cerró
    // en `candidatoFicha` de `leads.ts`, y aquí seguía abierto.
    //
    // Cortar aquí es seguro y no necesita `sinTurno` propio: esta función SOLO
    // LEE —no encola, no sella, no escribe—, y devolver menos candidatos es el
    // caso normal que el llamador ya maneja. Quien cuenta el corte para el
    // latido es `correrSdr`, que es quien sabe cuánto trabajo quedó.
    if (venceEn !== undefined && Date.now() >= venceEn) {
      logger.warn('sdr.busqueda.corte_por_reloj', { encontrados: elegidos.length });
      break;
    }
    const { data: hist, error: errHist } = await supabaseAdmin()
      .from('prospecto_contacto')
      .select('direccion, ocurrio_en')
      .eq('prospecto_id', f.id)
      .order('ocurrio_en', { ascending: true })
      .limit(50);
    if (errHist) throw new Error(`candidatosDeSeguimiento.historial: ${errHist.message}`);
    const h = (hist ?? []) as Array<{ direccion: string; ocurrio_en: string }>;
    if (h.some((x) => x.direccion === 'respuesta')) continue;      // contestó: humano al volante
    const salidas = h.filter((x) => x.direccion === 'salida');
    if (salidas.length === 0 || salidas.length > CADENCIA_SDR_DIAS.length) continue;

    // Rebote/queja de CUALQUIER pieza del prospecto lo saca de la cadencia.
    const { data: malas, error: errMalas } = await supabaseAdmin()
      .from('cola_aprobacion')
      .select('id')
      .eq('prospecto_id', f.id)
      .in('entrega_estado', ['rebotado', 'queja'])
      .limit(1);
    if (errMalas) throw new Error(`candidatosDeSeguimiento.entrega: ${errMalas.message}`);
    if ((malas ?? []).length > 0) continue;

    const primeraSalida = new Date(salidas[0].ocurrio_en).getTime();
    const diasDesde = (Date.now() - primeraSalida) / 86_400_000;
    const objetivoDias = CADENCIA_SDR_DIAS[salidas.length - 1];
    if (diasDesde < objetivoDias) continue;
    elegidos.push({
      id: f.id, empresa: f.empresa, contacto_nombre: f.contacto_nombre,
      numeroSeguimiento: salidas.length as 1 | 2,
    });
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
