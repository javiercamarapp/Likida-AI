// ═══════════════════════════════════════════════════════════════════════════
// EL REDACTOR (C5) — el primer correo de un prospecto del censo, A LA COLA.
//
// La última pieza de código de la Fase 2 del plan hacia el 90%. Ejecuta el
// prompt operativo de `prompts/redactor.md` (13-Agentes-de-AI) con las tres
// prohibiciones cableadas en el system prompt: no citar la vacante, cero
// personalización alucinada (solo hechos de la FILA del prospecto), y
// ninguna cifra fuera de la guía canónica ($38/$35/$31, ciclo ≈$105).
//
// LO QUE ESTE MÓDULO NUNCA HACE: enviar. Su única salida es `encolarPieza`
// (0117) — el envío vive en `enviarPiezaPorCorreo`, detrás de la aprobación
// humana, el CHECK enviar-solo-aprobado, la guardia de cadencia 48h y el
// tope diario. La pieza lleva la variante A LISTA PARA SALIR TAL CUAL en el
// cuerpo (aprobar-tal-cual tiene que ser un correo enviable, no un menú);
// las variantes B/C y los datos usados viajan en `fuentes` — trazabilidad
// que la bandeja enseña.
//
// COSTO: al log (`redactor.costo`), NO a `llm_costo` — misma decisión que el
// copiloto: esa tabla exige tenant y el Redactor es gasto de LIKIDA.
// ═══════════════════════════════════════════════════════════════════════════
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { DatoInvalido } from '../errores';
import { estaApagado } from '../interruptores';
import { generateResponse } from '@/lib/llm/openrouter';
import { createLlmBudget, type LlmBudget } from '@/lib/llm/budget';
import { encolarPieza } from './cola';
import { registrarCorrida, type DisparoCorrida } from './corridas';
import { logger } from '@/lib/logger';

// Las ÚNICAS cifras que el correo puede decir (prompts/redactor.md §3,
// guía canónica del 15-ago-2026). Cambiarlas aquí es cambiar el guion.
const CIFRAS_CANONICAS = `- $35 MXN por viaje liquidado, un tercio del costo del ciclo (tabulador: $38 hasta 500 viajes/mes · $35 de 500 a 5,000 · $31 arriba de 5,000; piso $9,500 MXN/mes)
- costo del ciclo completo ≈ $105 MXN por viaje (banda $94–115), porque lo tocan cinco puestos — tráfico, liquidación, facturación y cierre contable — no solo el liquidador
- estímulos: IEPS del diésel y 50% del peaje (sin porcentajes de ahorro inventados)
- validación de facturas ante el SAT`;

const SYSTEM = `Eres el redactor de primeros correos de Likida (liquidación de viajes de flotas de carga en México).

TU SALIDA NO SE ENVÍA. Va a una cola donde un humano la aprueba, la edita o la rechaza. Escribe como si supieras que un humano va a leer cada palabra antes de que salga, porque así es.

ESCRIBE 3 VARIANTES:
- Variante A — por el costo (la de default)
- Variante B — por el dinero fiscal (IEPS del diésel, 50% de peaje)
- Variante C — confirmación de demo (SOLO si el dossier trae un sí previo; si no, escribe exactamente: "No aplica: la variante C solo se usa después de un sí.")

REGLAS DE ESCRITURA:
- Máximo 5 líneas por correo. Asunto de máximo 6 palabras, sin signos de admiración. (El asunto de la variante A se sustituye después por el asunto fijo de la campaña — escríbelo igual: el de las variantes B/C sí sale.)
- PROHIBIDO el guion largo (—) en cualquier parte del correo.
- Si mencionas tracción, la ÚNICA frase permitida es "en pláticas con transportistas como Grupo GAL y Transportes Innovativos". PROHIBIDO decir "clientes reales" o llamar cliente a cualquier empresa: ninguna ha firmado.
- Termina SIEMPRE con una pregunta de agenda concreta: "¿le vienen bien 15 minutos el jueves?" — no "¿le interesaría platicar?".
- Remitente: el vendedor humano indicado, una persona. Nunca "el equipo de Likida".
- Español mexicano directo. Prohibido "revolucionario", "innovador", "inteligente", "de vanguardia", "solución integral". Sin emojis, sin negritas de venta, sin postdata de urgencia falsa.
- Si el dossier trae un Contacto, para dirigirte a él por su nombre escribe EXACTAMENTE el token \`{{NOMBRE}}\` (con las llaves dobles, tal cual) donde iría su nombre de pila — nunca inventes ni copies un nombre distinto. Ese token se reemplaza fuera de este modelo. Si el dossier dice "no capturado", no uses el token: saluda sin nombre ("Hola,").

LAS TRES PROHIBICIONES (romper cualquiera invalida el correo entero):
1. NO CITES LA VACANTE ni menciones que la viste. El dolor se alude por OFICIO: "liquidar viajes a mano", "el cierre administrativo del viaje", "la comprobación de gastos del operador".
2. PROHIBIDA LA PERSONALIZACIÓN ALUCINADA. Si un hecho no está en el DOSSIER, no existe. El único contexto permitido es el que el dossier trae.
3. NINGUNA CIFRA fuera de esta lista:
${CIFRAS_CANONICAS}

FORMATO DE SALIDA (exacto, markdown):
## Variante A — por el costo
**Asunto:** ...
[cuerpo]

## Variante B — por el dinero fiscal
**Asunto:** ...
[cuerpo]

## Variante C — confirmación de demo
**Asunto:** ...
[cuerpo o la línea de "No aplica"]

**Datos usados:** [cada hecho concreto del dossier que aparece en los correos, o "ninguno específico de esta empresa" — un correo genérico honesto es mejor que uno personalizado con datos inventados]`;

export interface PiezaRedactada {
  piezaId: string;
  asunto: string;
  /** Gasto de modelo de esta pieza, USD — lo suma el runner contra el techo. */
  costoUsd: number;
  /** Aviso honesto del agente (p. ej. "el prospecto no tiene correo capturado
   *  — conseguir el contacto ANTES de aprobar"). */
  aviso: string | null;
}

interface Variante { asunto: string; cuerpo: string }

/** Contexto de cobro del Redactor. Nunca se obtiene de un env global: el
 * caller autenticado o el runner debe entregar explícitamente el tenant que
 * paga la corrida. `budget` permite compartir una única reserva/run entre
 * varias piezas del mismo lote, sin reiniciar la contabilidad por prospecto.
 */
export interface RedactorExecutionContext {
  tenantId: string | null | undefined;
  budget?: LlmBudget;
  runId?: string;
  maxTenantDailyUsd?: number;
}

function presupuestoDelRedactor(contexto: RedactorExecutionContext | undefined): LlmBudget {
  if (contexto?.budget) {
    if (contexto.tenantId !== undefined && contexto.tenantId !== null
      && contexto.tenantId !== contexto.budget.tenantId) {
      throw new DatoInvalido('El presupuesto del Redactor no coincide con el tenant autenticado.');
    }
    return contexto.budget;
  }
  return createLlmBudget(contexto?.tenantId, contexto?.runId ?? randomUUID(), {
    maxTenantDailyUsd: contexto?.maxTenantDailyUsd,
  });
}

const MARCADOR_NOMBRE = '{{NOMBRE}}';

/** El asunto ÚNICO de la campaña de frío (plantilla asentada en la campaña
 *  real y ratificada el 27-ago-2026). La variante A siempre sale con él —
 *  se impone en CÓDIGO tras el parseo, no se le confía al modelo. */
export const ASUNTO_CAMPANA = 'Automatizar la liquidación de viajes, antes de contratar para el puesto';

/** El verificador ESTRUCTURAL del formato de campaña — los dos guardarraíles
 *  cazados en vivo en la campaña real: jamás "clientes reales" (ninguna
 *  empresa ha firmado; la frase permitida es "en pláticas con...") y sin
 *  guiones largos. Es código, no prompt: un correo que los viole NO entra a
 *  la cola. Exportado para su prueba. */
export function verificarFormatoCampana(texto: string): void {
  if (/clientes?\s+reales/i.test(texto)) {
    throw new DatoInvalido('El correo dice "clientes reales" — ninguna empresa ha firmado; la frase permitida es "en pláticas con transportistas como...". Pieza descartada.');
  }
  if (texto.includes('—')) {
    throw new DatoInvalido('El correo trae guion largo (—) — el formato de campaña los prohíbe. Pieza descartada.');
  }
}

/** El nombre de pila del contacto — lo único que se sustituye de vuelta, y
 *  SOLO fuera del modelo (ver la nota de AUDITORÍA 19 legal C2 en el
 *  dossier). `null` si no hay contacto capturado: sin nombre no hay nada
 *  que sustituir, y el SYSTEM le pide al modelo no usar el marcador en ese
 *  caso. Exportada para su prueba. */
export function primerNombreDelContacto(contactoNombre: string | null): string | null {
  const primero = contactoNombre?.trim().split(/\s+/)[0];
  return primero || null;
}

/**
 * Reemplaza el marcador por el nombre de pila real DESPUÉS de la completion
 * — el modelo nunca ve `nombre`. Si no hay nombre (el dossier decía "no
 * capturado" y aun así el modelo usó el marcador, o lo usó mal), se limpia
 * el saludo a secas en vez de dejar "Hola {{NOMBRE}}," visible en la pieza
 * que un humano va a aprobar.
 */
export function sustituirMarcador(texto: string, nombre: string | null): string {
  if (nombre) return texto.split(MARCADOR_NOMBRE).join(nombre);
  return texto
    .replace(new RegExp(`\\s*${MARCADOR_NOMBRE.replace(/[{}]/g, '\\$&')}\\s*,`, 'g'), ',')
    .split(MARCADOR_NOMBRE).join('');
}

/** Parsea la salida markdown del modelo. LANZA si la variante A no se puede
 *  extraer — una pieza malformada no entra a la cola. Exportada para su
 *  prueba: el parser es la frontera entre el modelo y la cola. */
export function parsearVariantes(md: string): { a: Variante; b: Variante | null; c: string | null; datosUsados: string | null } {
  const bloques = md.split(/^## /m).map((b) => b.trim()).filter(Boolean);
  const leer = (prefijo: string): Variante | null => {
    const b = bloques.find((x) => x.toLowerCase().startsWith(prefijo));
    if (!b) return null;
    const asunto = b.match(/\*\*Asunto:\*\*\s*(.+)/i)?.[1]?.trim();
    if (!asunto) return null;
    const cuerpo = b.split(/\*\*Asunto:\*\*.*\n/i)[1]?.split(/\*\*Datos usados:\*\*/i)[0]?.trim();
    if (!cuerpo) return null;
    return { asunto: asunto.slice(0, 120), cuerpo };
  };
  const a = leer('variante a');
  if (!a) throw new DatoInvalido('El Redactor devolvió una salida sin variante A legible — no se encoló nada. Reintenta.');
  const b = leer('variante b');
  const bloqueC = bloques.find((x) => x.toLowerCase().startsWith('variante c')) ?? null;
  const datosUsados = md.match(/\*\*Datos usados:\*\*\s*([\s\S]+)$/i)?.[1]?.trim().slice(0, 1_000) ?? null;
  return { a, b, c: bloqueC ? bloqueC.replace(/^variante c[^\n]*\n?/i, '').trim().slice(0, 2_000) : null, datosUsados };
}

/**
 * Redacta el primer correo de UN prospecto y lo deja en la cola de
 * aprobación. LANZA con palabras de pantalla en todo rechazo — quien apretó
 * el botón debe enterarse, no creer que hay una pieza esperando.
 */
export async function redactarCorreoFrio(
  prospectoId: string,
  vendedorNombre: string,
  /** 'manual' = botón del tablero; 'cron' = el runner nivel 2 (0123) — la
   *  corrida dice la verdad de quién la disparó. */
  disparo: DisparoCorrida = 'manual',
  contexto?: RedactorExecutionContext,
): Promise<PiezaRedactada> {
  const inicio = new Date();

  // 1) El kill switch — fail closed, como todos (interruptores.ts).
  if (await estaApagado('agente:redactor')) {
    throw new DatoInvalido('El Redactor está apagado — se enciende desde /admin/observabilidad o ⌘K.');
  }

  // El presupuesto se resuelve ANTES de leer/gastar el modelo. Un Redactor
  // sin tenant explícito no puede caer a un tenant global ni a un env de
  // plataforma: en producción se detiene cerrado.
  const budget = presupuestoDelRedactor(contexto);

  // 2) El prospecto REAL — el dossier es su fila, nada más (prohibición #2).
  const { data: p, error } = await acotada(supabaseAdmin()
    .from('prospecto')
    .select('id, empresa, contacto_nombre, correo, ciudad, estado, fuente, notas')
    .is('duplicado_de', null)
    .eq('id', prospectoId).maybeSingle(), 'redactor.prospecto');
  if (error) throw new Error(`redactarCorreoFrio: ${error.message}`);
  if (!p) throw new DatoInvalido('Ese prospecto no existe — recarga el tablero.');
  const prospecto = p as { id: string; empresa: string; contacto_nombre: string | null; correo: string | null; ciudad: string | null; estado: string; fuente: string; notas: string | null };
  if (prospecto.estado === 'cerrado' || prospecto.estado === 'perdido') {
    throw new DatoInvalido(`Este prospecto está ${prospecto.estado} — a un ${prospecto.estado} no se le redacta correo frío.`);
  }

  // 3) La regla del censo finito: contactado hace <48h NO se vuelve a tocar
  //    — se lee el historial ANTES de gastar en el modelo, y si el historial
  //    no se puede leer, no se redacta (fail closed, misma regla que el
  //    envío). También frena la pieza duplicada: ya hay una pendiente de
  //    este prospecto en la cola → no se fabrica otra.
  const hace48h = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const { data: recientes, error: errHist } = await supabaseAdmin()
    .from('prospecto_contacto').select('ocurrio_en')
    .eq('prospecto_id', prospectoId).eq('direccion', 'salida')
    .gte('ocurrio_en', hace48h).limit(1);
  if (errHist) throw new DatoInvalido('No se pudo leer el historial del prospecto — sin él no se redacta (la cadencia no se verifica a ciegas). Reintenta.');
  if ((recientes ?? []).length > 0) {
    throw new DatoInvalido('A este prospecto se le escribió hace menos de 48 horas — la cadencia lo protege. Reintenta cuando pase la ventana.');
  }
  const { data: pendientes, error: errPend } = await supabaseAdmin()
    .from('cola_aprobacion').select('id')
    .eq('prospecto_id', prospectoId).eq('estado', 'pendiente').limit(1);
  if (errPend) throw new DatoInvalido('No se pudo verificar la cola — reintenta.');
  if ((pendientes ?? []).length > 0) {
    throw new DatoInvalido('Este prospecto ya tiene una pieza esperando aprobación — resuélvela antes de redactar otra.');
  }

  // 4) El dossier: SOLO los hechos de la fila, declarados como tales.
  //
  // AUDITORÍA 19 (legal C2, CRÍTICO): el aviso de privacidad del Cerebro de
  // ventas promete «tu nombre no sale de Likida: la ficha que recibe el
  // modelo de lenguaje lleva un marcador en lugar de tu nombre... tu nombre
  // de pila se pone después, dentro de Likida» (privacidad.ts:757) — pero
  // este archivo mandaba `prospecto.contacto_nombre` COMPLETO, tal cual, a
  // un modelo externo (OpenRouter). El aviso describía un mecanismo que
  // nunca se construyó. `primerNombreDelContacto` se queda LOCAL: el modelo
  // solo ve el marcador `{{NOMBRE}}` (instrucción en SYSTEM); el nombre de
  // pila real se sustituye DESPUÉS de la completion, en `sustituirMarcador`.
  const primerNombre = primerNombreDelContacto(prospecto.contacto_nombre);

  // LA INVESTIGACIÓN (0217): si el investigador ya dejó dossier, sus hechos
  // — cada uno leído del sitio real de la empresa, con fuente — SON hechos
  // verificados y entran al contexto permitido. Es la única ampliación de la
  // prohibición #2: personalizar con lo investigado, jamás con lo imaginado.
  // Lectura best-effort deliberada: sin dossier (o con la lectura caída) el
  // correo sale genérico honesto, que siempre fue el piso del Redactor.
  const lineasInvestigadas: string[] = [];
  try {
    const { data: d, error: errD } = await supabaseAdmin()
      .from('prospecto_dossier')
      .select('historia, empleados, flotilla, datos')
      .eq('prospecto_id', prospectoId).maybeSingle();
    if (errD) {
      logger.info('redactor.dossier_ilegible', { prospecto: prospectoId, err: errD.message });
    } else if (d) {
      const dd = d as { historia: string | null; empleados: string | null; flotilla: string | null; datos: Array<{ dato?: string }> | null };
      if (dd.historia) lineasInvestigadas.push(`Historia (de su sitio): ${dd.historia.slice(0, 300)}`);
      if (dd.empleados) lineasInvestigadas.push(`Tamaño (de su sitio): ${dd.empleados.slice(0, 150)}`);
      if (dd.flotilla) lineasInvestigadas.push(`Flota (de su sitio): ${dd.flotilla.slice(0, 150)}`);
      for (const h of (dd.datos ?? []).slice(0, 4)) {
        if (h?.dato) lineasInvestigadas.push(`Hallazgo (de su sitio): ${h.dato.slice(0, 200)}`);
      }
    }
  } catch (e) {
    logger.info('redactor.dossier_ilegible', { prospecto: prospectoId, err: e instanceof Error ? e.message : String(e) });
  }

  const dossier = [
    `Empresa: ${prospecto.empresa}`,
    primerNombre ? 'Contacto: {{NOMBRE}}' : 'Contacto: no capturado',
    prospecto.ciudad ? `Ciudad: ${prospecto.ciudad}` : 'Ciudad: no capturada',
    `Etapa del pipeline: ${prospecto.estado}`,
    prospecto.notas ? `Notas del vendedor: ${prospecto.notas.slice(0, 500)}` : 'Notas: ninguna',
    ...lineasInvestigadas,
    '(No hay más hechos verificados. Lo que no esté aquí, NO existe.)',
  ].join('\n');

  // 5) El modelo — una sola completion, sin tools.
  let texto: string;
  let costoUsd = 0;
  try {
    const r = await generateResponse({
      // El rol BARATO del back office (16-ago-2026) — por aquí pasan datos
      // de PROSPECTOS, nunca RFC/CFDI de un cliente (la frontera y el
      // proveedor viven en models.ts).
      role: 'back_office',
      system: SYSTEM,
      messages: [{ role: 'user', content: `DOSSIER:\n${dossier}\n\nVENDEDOR (remitente): ${vendedorNombre}` }],
      maxTokens: 900,
      temperature: 0.5,
      budget,
    });
    texto = r.text;
    costoUsd = r.cost;
    // TOOL-CALLING-19C2-1 (barrido MEDIO/BAJO): `r.cost` sin `usage` real del
    // proveedor es la RESERVA conservadora, no lo medido — mismo criterio
    // que `noMedido` en `intake/ocr.ts`. Sin la marca, esta fila de costo se
    // veía igual de confiable que una medida de verdad.
    logger.info('redactor.costo', {
      costoUsd: r.cost, tokensIn: r.tokensIn, tokensOut: r.tokensOut,
      modelo: r.noMedido ? `${r.model}:no_medido` : r.model,
    });
    if (r.noMedido) logger.warn('redactor.costo_no_medido', { prospecto: prospectoId });
  } catch (e) {
    await registrarCorrida(null, 'redactor', {
      inicio, fin: new Date(), estado: 'fallo', disparo,
      resumen: { prospecto: prospectoId },
      error: 'El modelo no respondió.',
    });
    logger.error('redactor.modelo_fallo', { prospecto: prospectoId, err: e instanceof Error ? e.message : String(e) });
    throw new DatoInvalido('El Redactor no pudo escribir en este momento — inténtalo de nuevo.');
  }

  // 6) Parsear, SUSTITUIR el marcador por el nombre de pila real (nunca visto
  // por el modelo — AUDITORÍA 19 legal C2), y ENCOLAR. La pieza jamás sale de
  // aquí hacia ningún correo.
  let pieza: PiezaRedactada;
  try {
    const v = parsearVariantes(texto);
    const con = (s: string) => sustituirMarcador(s, primerNombre);
    // El asunto de la campaña se IMPONE (no se le confía al modelo), y el
    // cuerpo pasa por el verificador estructural: "clientes reales" o un
    // guion largo descartan la pieza entera — mejor cero correo que uno que
    // rompa los guardarraíles cazados en vivo.
    const asuntoA = ASUNTO_CAMPANA;
    const cuerpoA = con(v.a.cuerpo);
    verificarFormatoCampana(cuerpoA);
    const varianteB = v.b ? { asunto: con(v.b.asunto), cuerpo: con(v.b.cuerpo) } : null;
    const varianteC = v.c ? con(v.c) : null;
    const aviso = prospecto.correo?.trim()
      ? null
      : 'El prospecto no tiene correo capturado — conseguir el contacto ANTES de aprobar.';
    const piezaId = await encolarPieza({
      tipo: 'correo_frio', prioridad: 'normal', agente: 'redactor',
      prospectoId, titulo: asuntoA,
      cuerpo: cuerpoA,
      fuentes: {
        variante_b: varianteB, variante_c: varianteC, datos_usados: v.datosUsados,
        dossier: { empresa: prospecto.empresa, ciudad: prospecto.ciudad, etapa: prospecto.estado, fuente: prospecto.fuente },
        ...(aviso ? { aviso } : {}),
      },
    });
    pieza = { piezaId, asunto: asuntoA, aviso, costoUsd };
  } catch (e) {
    // El modelo YA gastó: el costo se registra aunque la pieza no entrara —
    // tirarlo dejaría al techo diario ciego al modo de falla que más gasta.
    await registrarCorrida(null, 'redactor', {
      inicio, fin: new Date(), estado: 'fallo', disparo, costoUsd,
      resumen: { prospecto: prospectoId },
      error: e instanceof DatoInvalido ? e.message : 'No se pudo encolar la pieza.',
    });
    throw e;
  }

  await registrarCorrida(null, 'redactor', {
    inicio, fin: new Date(), estado: 'ok', disparo, costoUsd,
    tareasHechas: 1, tareasTotal: 1,
    resumen: { prospecto: prospectoId, pieza: pieza.piezaId, con_correo: Boolean(prospecto.correo?.trim()) },
  });
  return pieza;
}
