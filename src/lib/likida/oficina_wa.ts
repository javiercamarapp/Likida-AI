import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { traerTodo } from './pg';
import { registrarCosto, faseDeModelo } from './costos';
import { gastoChatHoyUsd, topeDiaUsd } from '@/app/api/dashboard/chat/tope';
import { strip_accents } from './cuadre/util';
import { getTableroOperacion } from './operacion';
import { generarInformePDF, type Informe, type KpiInforme } from './informes/pdf';
import { ejecutarAnalista, type Bloque } from '@/lib/agents/analista';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { sendDocument } from '@/lib/meta/client';
import { mxn, numero, fechaMx } from '@/lib/formato';
import type { RolOficina } from './contactos';

// ═══════════════════════════════════════════════════════════════════════════
// EL CICLO COMPLETO DE LA OFICINA POR WHATSAPP (17-ago-2026).
//
// Orden de Javier: "el dashboard es meramente si quieren usarlo — el ciclo
// queda cerrado desde WhatsApp y desde ahí pueden pedir informes, reportes,
// datos, insights, todo". Dos piezas nuevas sobre lo que ya existía
// (despacho, talacha, "¿cómo van?"):
//
//  1. EL INFORME EN PDF: "mándame el informe en pdf" → el motor de informes
//     (informes/pdf.ts, canon visual de la casa) arma el documento con las
//     cifras REALES, se sube a storage y llega como documento de WhatsApp —
//     el mismo camino que ya recorre el PDF de liquidación.
//  2. LA PREGUNTA LIBRE: lo que no casa con ningún patrón anclado deja de
//     caer al saludo genérico para el DUEÑO y el CONTADOR: lo contesta el
//     MISMO analista del panel (mismas tools de lectura, misma guardia de
//     cifras) convertido a texto de WhatsApp. El encargado NO pasa por aquí:
//     las tools del analista devuelven pesos y su rol no los ve
//     (visibilidad.ts) — el canal no puede ser la puerta trasera.
// ═══════════════════════════════════════════════════════════════════════════

export interface CuentaInforme {
  tenantId: string;
  rol: RolOficina;
  userId: string;
  nombre: string | null;
}

function normalizar(texto: string): string {
  return strip_accents(texto.toLowerCase()).replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
}

const MAX_LARGO_PETICION = 90;

/** ¿Pide el informe EN DOCUMENTO? Exige la palabra del reporte Y la del
 *  formato — "¿cómo van?" y el informe de texto siguen siendo de
 *  informes_wa; esto atiende "mándame el informe en pdf". */
export function pideInformePdf(texto: string): boolean {
  const n = normalizar(texto);
  if (n.length > MAX_LARGO_PETICION) return false;
  return /\b(informe|reporte|resumen)\b/.test(n) && /\b(pdf|documento|archivo|imprimible|formal)\b/.test(n);
}

/**
 * Arma el informe de operación con cifras REALES y lo manda como documento.
 * El dinero (anticipos en la calle) solo entra si el rol ve `dinero` en el
 * panel — la misma matriz, jamás una copia. Devuelve el texto de acuse, o
 * lanza para que el llamador conteste el fallo con honestidad.
 */
export async function mandarInformePdf(cuenta: CuentaInforme, telefono: string): Promise<string> {
  const admin = supabaseAdmin();
  const [tablero, rTenant] = await Promise.all([
    getTableroOperacion(cuenta.tenantId),
    admin.from('tenant').select('nombre').eq('id', cuenta.tenantId).maybeSingle(),
  ]);
  const kpis: KpiInforme[] = [
    { etiqueta: 'Viajes activos', valor: numero(tablero.viajesActivos) },
    { etiqueta: 'Sin unidad', valor: numero(tablero.sinUnidad) },
    { etiqueta: 'Entregas sin evidencia', valor: numero(tablero.podPendientes) },
  ];
  const secciones: Informe['secciones'] = [];
  if (puedeVerArea(cuenta.rol, 'dinero')) {
    // La MISMA consulta que el informe de texto (informes_wa): suma de
    // anticipos de viajes sin cerrar. Fallar cerrado: si no se puede leer,
    // la sección lo dice — nunca un cero con cara de medición.
    //
    // AUDITORÍA 22, REN-1 (CRÍTICO): esto manejaba `error` y ahí se detenía,
    // que es la mitad del problema. PostgREST recorta a 1,000 filas EN
    // SILENCIO —sin error y sin bandera—, así que una flota con 1,500 viajes
    // sin cerrar recibía la suma de 1,000 impresa como «Anticipos en la
    // calle», y «Viajes sin liquidar» decía 1,000. Una cifra incompleta con
    // cara de completa es el mismo pecado que el cero con cara de medición, y
    // esta va en un PDF firmado que el dueño reenvía a su contador.
    //
    // `traerTodo` pagina con `count` y LANZA `LecturaIncompleta` si no puede
    // demostrar que leyó todo — que es justo lo que este `catch` necesita para
    // decirlo en vez de imprimirlo corto.
    try {
      const filas = await traerTodo<{ anticipo: number | null }>(
        (desde, hasta) => admin.from('viaje')
          .select('anticipo', { count: 'exact' })
          .eq('tenant_id', cuenta.tenantId).in('estatus', ['abierto', 'en_cuadre'])
          .range(desde, hasta),
        'oficina.anticipos_en_calle',
      );
      const suma = filas.reduce((acc, v) => acc + (typeof v.anticipo === 'number' ? v.anticipo : 0), 0);
      secciones.push({
        titulo: 'Dinero',
        filas: [
          ['Anticipos en la calle', mxn(suma)],
          ['Viajes sin liquidar', numero(filas.length)],
        ],
      });
    } catch (e) {
      logger.error('oficina.anticipos_no_leidos', { tenantId: cuenta.tenantId, err: String(e) });
      secciones.push({ titulo: 'Dinero', parrafos: ['Los anticipos no se pudieron leer completos en este momento — la cifra existe, el sistema no la alcanzó. Vuelve a pedir el informe en unos minutos.'] });
    }
  }
  secciones.push({
    titulo: 'Operación',
    filas: [
      ['Viajes activos', numero(tablero.viajesActivos)],
      ['En curso sin unidad asignada', numero(tablero.sinUnidad)],
      ['Entregas sin evidencia (POD)', numero(tablero.podPendientes)],
    ],
  });
  const inf: Informe = {
    titulo: 'Informe de operación',
    razonSocial: rTenant.data?.nombre ?? null,
    periodo: fechaMx(new Date().toISOString()),
    kpis,
    secciones,
    notas: ['Generado a petición por WhatsApp. Cifras del sistema al momento de la solicitud; nada se estima.'],
  };
  const bytes = await generarInformePDF(inf);
  const path = `informes/${cuenta.tenantId}/informe-${Date.now()}.pdf`;
  const up = await acotada(
    supabaseAdmin().storage.from('liquidaciones').upload(path, Buffer.from(bytes), { contentType: 'application/pdf', upsert: true }),
    'informe.upload',
  );
  if (up.error) throw new Error(`informe.upload: ${up.error.message}`);
  const firma = await acotada(supabaseAdmin().storage.from('liquidaciones').createSignedUrl(path, 300), 'informe.firmar');
  if (firma.error || !firma.data?.signedUrl) throw new Error(`informe.firmar: ${firma.error?.message ?? 'sin URL'}`);
  const enviado = await sendDocument(telefono, firma.data.signedUrl, `informe-operacion.pdf`, 'Tu informe de operación 📊');
  // `sendDocument` devuelve un objeto discriminado, NO un booleano: `{ok:false}`
  // es truthy, así que `if (!enviado)` nunca disparaba y un rechazo de Meta se
  // acusaba como entregado. Mismo criterio que `processor.ts` y `avisar_cierre.ts`.
  if (!enviado.ok) throw new Error(`informe.envio: WhatsApp no aceptó el documento: ${enviado.error}`);
  return 'Ahí te va tu informe en PDF 📊 — cifras del sistema de este momento.';
}

// ── La pregunta libre → el analista del panel, en texto de WhatsApp ────────

/** Solo estos roles pasan al analista: sus tools devuelven pesos y son los
 *  roles que los ven en el panel. El encargado sigue con sus patrones. */
export function rolConAnalista(rol: RolOficina): boolean {
  return rol === 'flota_admin' || rol === 'contador';
}

/** Bloques del analista → texto plano de WhatsApp. Sin tablas dibujadas ni
 *  gráficas: filas como líneas, y la gráfica se declara como del panel. */
export function bloquesATextoWa(bloques: Bloque[]): string {
  const lineas: string[] = [];
  for (const b of bloques) {
    if (b.tipo === 'texto') lineas.push(b.texto);
    else if (b.tipo === 'cifra') {
      const v = b.formato === 'mxn' ? mxn(b.valor) : b.formato === 'litros' ? `${numero(b.valor)} L` : numero(b.valor);
      lineas.push(b.nota ? `*${v}* — ${b.nota}` : `*${v}*`);
    } else if (b.tipo === 'tabla') {
      for (const [k, v] of b.filas.slice(0, 10)) lineas.push(`· ${k}: ${typeof v === 'number' ? numero(v) : v}`);
    } else {
      lineas.push('(la gráfica de esto está en tu panel)');
    }
  }
  return lineas.join('\n').trim();
}

/**
 * La pregunta libre de la oficina. `null` = este rol no pasa por aquí, O el
 * analista falló — en ambos casos cae al SALUDO, que orienta ("pregúntame
 * ¿cómo van?", el panel) en vez de dejar un callejón sin salida. El fallo
 * queda en el log; degradar a la guía es mejor que un error pelón.
 */
export async function atenderPreguntaLibre(cuenta: CuentaInforme, texto: string): Promise<string | null> {
  if (!rolConAnalista(cuenta.rol)) return null;
  const { data } = await supabaseAdmin().from('tenant').select('nombre').eq('id', cuenta.tenantId).maybeSingle();
  // ── AUDITORÍA 22, REN-A1 (ALTO): EL MISMO ANALISTA, SIN FRENO NI CUENTA ──
  // Esto corre el analista COMPLETO —hasta nueve completions con tools— y no
  // registraba un centavo en `llm_costo` ni pasaba por el tope diario. El chat
  // del panel, que ejecuta EXACTAMENTE el mismo agente, hace las dos cosas
  // (api/dashboard/chat/route.ts). O sea: el mismo gasto, por otro canal, era
  // invisible para el panel de costo y para el freno — y el canal de WhatsApp
  // es justamente el que el producto empuja como principal.
  //
  // El tope se lee igual y falla CERRADO, con el mismo criterio: si no se pudo
  // verificar el presupuesto, no se gasta más.
  let gastadoHoy: number;
  try {
    gastadoHoy = await gastoChatHoyUsd(cuenta.tenantId);
  } catch (e) {
    logger.error('oficina.tope_dia.error', { tenantId: cuenta.tenantId, err: e instanceof Error ? e.message : String(e) });
    return 'No pude verificar el presupuesto de IA del día, así que mejor no sigo por ahí. Vuelve a preguntarme en un rato.';
  }
  if (gastadoHoy >= topeDiaUsd()) {
    return 'El análisis con IA de hoy llegó a su tope diario (existe para cuidar tu costo). Mañana se renueva solo; mientras, pídeme el informe o el estatus, que no gastan.';
  }

  try {
    const r = await ejecutarAnalista({
      tenantId: cuenta.tenantId,
      nombreFlota: data?.nombre ?? 'tu flota',
      usuario: { nombre: cuenta.nombre, rol: cuenta.rol },
      mensajes: [{ rol: 'usuario', texto: texto.slice(0, 1500) }],
      timeoutMs: 35_000,
    });
    // POR MODELO real, mismo criterio que el chat del panel y que processor.ts:
    // una sola etiqueta miente cuando hubo fallback entre proveedores.
    for (const [modelo, c] of Object.entries(r.costoPorModelo ?? {})) {
      try {
        await registrarCosto({
          tenantId: cuenta.tenantId, viajeId: null, fase: faseDeModelo(modelo, 'chat'), modelo,
          tokensIn: c.tokensIn, tokensOut: c.tokensOut, costoUsd: c.cost,
        });
      } catch (e2) {
        // El costo no registrado NO se traga la respuesta del jefe, pero sí se
        // dice: un gasto invisible es exactamente lo que este arreglo cierra.
        logger.error('oficina.costo_sin_registrar', { tenantId: cuenta.tenantId, err: e2 instanceof Error ? e2.message : String(e2) });
      }
    }
    const salida = bloquesATextoWa(r.bloques);
    return salida || 'No alcancé a armar esa respuesta. ¿Me la repites de otra forma?';
  } catch (e) {
    logger.error('oficina.analista', { user: cuenta.userId, err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
