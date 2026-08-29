// ═══════════════════════════════════════════════════════════════════════════
// COMANDOS DE ADMINISTRACIÓN POR WHATSAPP (mig. 0059 — app_user.telefono).
//
// Hasta hoy el webhook solo reconocía CHOFERES (`operador`) y, desde
// `contactos.ts`, cuentas de OFICINA que despachan, asignan y piden informes
// (`atenderTextoOficina`). Lo que faltaba: que Javier (superadmin) pudiera
// operar SU PROPIO panel — /admin/aprobaciones, /admin/tu-turno — sin abrir
// una laptop. Este módulo es la puerta de ESE panel, no una nueva.
//
// ── GRAMÁTICA (el único lugar que la interpreta — ampliar AQUÍ) ────────────
//
//   estatus                → resumen de rutinas + colas de aprobación.
//   estatus <rutina>       → el detalle de esa rutina puntual.
//   aprobar <id>           → aprueba la pieza pendiente <id> (ve abajo: dos
//                            colas homónimas por casualidad del dominio).
//   correr <rutina>        → encola "correr ahora" para <rutina>; la Mac la
//                            ejecuta en su siguiente latido (bus_orden).
//
// Insensible a mayúsculas; el nombre de rutina se normaliza a minúsculas
// (`validarOrden` en bus.ts exige `^[a-z0-9-]{2,40}$`). El id de "aprobar" es
// el UUID que se ve en la pantalla — no se valida su forma exacta, solo que
// no traiga espacios ni caracteres raros: si no existe, la propia consulta
// lo dice.
//
// Un texto que empieza con OTRA palabra devuelve `null` — no es de este
// módulo, y el processor sigue con el resto de sus reconocedores (informe,
// pregunta libre). Un texto que SÍ empieza con "aprobar"/"correr"/"estatus"
// pero está mal formado (sin argumento, argumento con forma rara) NO cae al
// analista: el analista contesta CUALQUIER cosa y "aprobar" a medias
// merece una corrección clara, no una respuesta genérica que esconda que el
// comando SÍ se reconoció. Riesgo aceptado: quien manda estas tres palabras
// sueltas en una frase normal ("voy a aprobar el diseño mañana") es SIEMPRE
// un flota_admin o el superadmin — nunca un chofer ni un desconocido — así
// que el costo de un falso positivo es una corrección de una línea, no una
// acción indebida (el candado de rol sigue aplicando incluso ahí).
//
// ── ALCANCE DE ROL: SOLO SUPERADMIN, Y NO ES UN DEFAULT ────────────────────
//
// Las tres acciones tocan tablas SIN `tenant_id` — `cola_aprobacion` (envíos
// de prospección) y `bus_pieza`/`bus_rutina`/`bus_orden` (la Mac de Javier,
// mig. 0127) son de PLATAFORMA, no de una flota. No existe "aprobar la pieza
// DE MI flota": la pieza no pertenece a ninguna, y dejar pasar a un
// flota_admin no sería darle una palanca de SU tenant — sería darle la
// consola entera de Javier. Por eso, aunque `RolOficina` incluye
// 'flota_admin' y `resolverCuentaOficina` ya autentica su teléfono con la
// misma confianza que el del chofer (es Meta quien firma el remitente), este
// módulo niega el paso a cualquiera que no sea 'superadmin' — con un mensaje
// honesto, nunca con silencio ni con un "no te entendí" que esconda que el
// comando SÍ se reconoció. La negación se anota como evento de seguridad
// (`acceso_denegado`), igual que cualquier otro intento fuera de rol en este
// repo.
//
// Si algún día una flota necesita su PROPIA cola de aprobación por WhatsApp
// (aprobar un gasto, por ejemplo), esa es una gramática y una tabla nuevas
// — con su propio `tenant_id` en el WHERE — y no una relajación de ÉSTA.
//
// ── "APROBAR <id>" MIRA DOS COLAS, A PROPÓSITO ─────────────────────────────
//
// `/admin/aprobaciones` (forma-pieza.tsx) resuelve `cola_aprobacion`
// (envíos de prospección, `agentes/cola.ts`). `/admin/tu-turno` resuelve
// `bus_pieza` (piezas que las rutinas de la Mac dejan para revisar,
// `admin/bus.ts`). Son DOS colas de aprobación, homónimas por casualidad del
// dominio ("pieza" describe ambas) — y quien teclea un id desde el teléfono
// no tiene por qué saber en cuál vive. Se intenta primero `cola_aprobacion`
// (más frecuente) y, SOLO si esa consulta dice "no está pendiente ahí" (no
// ante un fallo real de base, que se contesta tal cual y no se enmascara con
// un segundo intento), se prueba `bus_pieza`. Si ninguna la tiene, se dice
// la verdad: no existe en ninguna de las dos.
//
// ── LA IDEMPOTENCIA Y EL RATE LIMIT YA EXISTEN, Y SON LOS DE SIEMPRE ───────
//
// Esta función se invoca desde `atenderTextoOficina`, que a su vez corre
// DENTRO de `procesarTurno` — el mismo turno que ya reclamó su `waMessageId`
// contra `wa_mensaje_procesado` (`claimMessage`, en `processInbound`) antes
// de llegar aquí. Una reentrega de Meta del MISMO mensaje ("aprobar X" que
// llega dos veces porque el 200 se perdió en el camino) nunca re-ejecuta:
// vuelve como 'duplicado' y ni siquiera entra a este archivo. Y el mismo
// tope de `route.ts` (40 mensajes/min por teléfono) ya cubre al admin que
// manda el mismo comando a mano diez veces seguidas. No hace falta un
// segundo mecanismo — construir uno aparte sería duplicar una garantía que
// ya existe y arriesgar que se desincronice de la real.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { fechaHoraMx } from '@/lib/formato';
import { registrarEventoSeguridad } from '@/lib/seguridad/eventos';
import { anotarBitacora } from './bitacora_escritura';
import { DatoInvalido, mensajeParaPantalla } from './errores';
import { aprobarPieza, bandejaPendiente } from './agentes/cola';
import { getEstadoBus, crearOrden, resolverPieza, type EstadoBus, type RutinaBus } from '@/lib/admin/bus';
import type { RolOficina } from './contactos';

/** Lo mínimo que este módulo necesita saber de quien escribe. */
export interface CuentaAdminWa {
  userId: string;
  email: string;
  tenantId: string | null;
  rol: RolOficina;
}

export type ComandoAdminWa =
  | { tipo: 'estatus'; rutina: string | null }
  | { tipo: 'aprobar'; id: string }
  | { tipo: 'correr'; rutina: string }
  | { tipo: 'malformado'; verbo: 'estatus' | 'aprobar' | 'correr' };

const RE_RUTINA = /^[a-z0-9-]{2,40}$/;
const RE_ID = /^[0-9a-zA-Z-]{4,80}$/;

/**
 * La gramática, y nada más que la gramática. `null` = este texto no es un
 * comando de administración (el primer token no es ninguno de los tres
 * verbos) — el llamador sigue con sus otros reconocedores.
 */
export function interpretarComandoAdmin(texto: string): ComandoAdminWa | null {
  const t = texto.trim();
  if (!t) return null;
  // Partido a mano (y no con un solo regex `(\S+)(?:\s+(.*))?`) para no
  // dejar un grupo opcional anidado que el linter marca como riesgo de
  // backtracking — el resultado es idéntico y más fácil de leer.
  const espacio = t.search(/\s/u);
  const verbo = (espacio === -1 ? t : t.slice(0, espacio)).toLowerCase();
  const resto = (espacio === -1 ? '' : t.slice(espacio + 1)).trim();

  if (verbo === 'estatus') {
    if (!resto) return { tipo: 'estatus', rutina: null };
    const rutina = resto.toLowerCase();
    return RE_RUTINA.test(rutina) ? { tipo: 'estatus', rutina } : { tipo: 'malformado', verbo: 'estatus' };
  }
  if (verbo === 'aprobar') {
    return RE_ID.test(resto) ? { tipo: 'aprobar', id: resto } : { tipo: 'malformado', verbo: 'aprobar' };
  }
  if (verbo === 'correr') {
    const rutina = resto.toLowerCase();
    return RE_RUTINA.test(rutina) ? { tipo: 'correr', rutina } : { tipo: 'malformado', verbo: 'correr' };
  }
  return null;
}

function mensajeAyuda(verbo: 'estatus' | 'aprobar' | 'correr'): string {
  switch (verbo) {
    case 'aprobar':
      return 'Así se usa: "aprobar <id>" — el id de la pieza pendiente que ves en el panel.';
    case 'correr':
      return 'Así se usa: "correr <rutina>" — el nombre exacto de la rutina (ej. "correr auditoria-diaria").';
    case 'estatus':
      return 'Así se usa: "estatus" (todas las rutinas) o "estatus <rutina>" (una en concreto).';
  }
}

function mensajeEstatusRutina(r: RutinaBus): string {
  const u = r.ultimaCorrida;
  if (!u) return `📋 ${r.nombre} (${r.horario || 'sin horario declarado'}) — todavía no registra ninguna corrida.`;
  if (!u.fin) return `📋 ${r.nombre} — corriendo ahora mismo (empezó ${fechaHoraMx(u.inicio)}).`;
  const resultado = u.veredicto ?? (u.exitCode === 0 ? 'ok' : `salió con error (código ${u.exitCode ?? '?'})`);
  const pr = u.prUrl ? `\nPR: ${u.prUrl}` : '';
  return `📋 ${r.nombre} — última corrida ${fechaHoraMx(u.fin)}: ${resultado}.${pr}`;
}

function mensajeEstatusGeneral(bus: EstadoBus, cola: { urgentes: number; normales: number } | null): string {
  const total = bus.rutinas.length;
  const enCurso = bus.rutinas.filter((r) => r.ultimaCorrida && !r.ultimaCorrida.fin).length;
  const conError = bus.rutinas.filter((r) => r.ultimaCorrida?.fin && r.ultimaCorrida.exitCode !== 0).length;
  const lineas = [
    `📋 ${total} rutina(s) en el catálogo` +
      (enCurso ? `, ${enCurso} corriendo ahora` : '') +
      (conError ? `, ${conError} con error en su última corrida` : '') + '.',
    `🧩 ${bus.piezasPendientes.length} pieza(s) de rutina esperando aprobación (bus).`,
    cola
      ? `✉️ ${cola.urgentes + cola.normales} envío(s) por aprobar (${cola.urgentes} urgente(s), ${cola.normales} normal(es)).`
      : '✉️ No pude leer la cola de envíos ahorita.',
    bus.killSwitchPendiente ? '🔴 Hay un kill switch pendiente de aplicar.' : null,
    bus.errores.length ? `⚠️ No pude leer: ${bus.errores.join('; ')}.` : null,
  ].filter((l): l is string => Boolean(l));
  return lineas.join('\n');
}

/** El único escritor de la bitácora DESDE este módulo (0053: el patrón de la
 *  casa es un escritor único por archivo; `anotarBitacora` es el escritor
 *  único de la TABLA, esto solo evita repetir la forma seis veces). */
function registrar(cuenta: CuentaAdminWa, from: string, accion: string, entidadId: string, detalle: Record<string, unknown>): Promise<boolean> {
  return anotarBitacora(
    {
      tenantId: null, // acción de PLATAFORMA, no de una flota — igual que cola/bus.
      actor: { id: cuenta.userId, email: cuenta.email },
      accion,
      entidad: 'comando_admin_wa',
      entidadId,
      detalle: { canal: 'whatsapp', telefono: from, ...detalle },
    },
    { evento: 'admin_wa.bitacora_no_escribio', contexto: { accion } },
  );
}

/**
 * El turno de un mensaje que puede ser un comando de administración de
 * plataforma. Devuelve la respuesta que hay que mandar, o `null` si el
 * texto no es de este circuito (el processor sigue con informe/analista).
 */
export async function atenderComandoAdmin(
  cuenta: CuentaAdminWa,
  from: string,
  texto: string,
): Promise<string | null> {
  const cmd = interpretarComandoAdmin(texto);
  if (!cmd) return null;

  // EL ROL SE DECIDE ANTES QUE LA FORMA, a propósito: un flota_admin que
  // manda "aprobar" (sin id) recibe la MISMA negación que uno que manda
  // "aprobar <id>" bien formado — nunca la ayuda de sintaxis del comando de
  // plataforma que no puede usar. Enseñarle "así se usa" a quien no tiene
  // permiso es enseñarle la gramática de una consola que no es suya.
  if (cuenta.rol !== 'superadmin') {
    void registrarEventoSeguridad({
      origen: 'wa_webhook', tipo: 'acceso_denegado', severidad: 'alta',
      actor: cuenta.userId, tenantId: cuenta.tenantId,
      detalle: { canal: 'whatsapp_admin', comando: cmd.tipo, rol: cuenta.rol },
    });
    return 'No tienes permiso para comandos de administración de plataforma — son solo del superadmin.';
  }

  if (cmd.tipo === 'malformado') return mensajeAyuda(cmd.verbo);

  if (cmd.tipo === 'estatus') {
    let bus: EstadoBus;
    try {
      bus = await getEstadoBus();
    } catch (e) {
      logger.error('admin_wa.estatus_error', { err: e instanceof Error ? e.message : String(e) });
      return 'No pude leer el estatus ahorita — inténtalo de nuevo en un momento.';
    }
    if (cmd.rutina) {
      const r = bus.rutinas.find((x) => x.nombre === cmd.rutina);
      if (!r) {
        const disponibles = bus.rutinas.map((x) => x.nombre).slice(0, 15).join(', ') || '(catálogo vacío)';
        await registrar(cuenta, from, 'admin_wa.estatus', cmd.rutina, { resultado: 'no_encontrada' });
        return `No encontré la rutina "${cmd.rutina}". Rutinas disponibles: ${disponibles}.`;
      }
      await registrar(cuenta, from, 'admin_wa.estatus', cmd.rutina, { resultado: 'ok' });
      return mensajeEstatusRutina(r);
    }
    const cola = await Promise.all([bandejaPendiente('urgente'), bandejaPendiente('normal')])
      .then(([u, n]) => ({ urgentes: u.length, normales: n.length }))
      .catch((e) => {
        logger.error('admin_wa.estatus_cola_error', { err: e instanceof Error ? e.message : String(e) });
        return null;
      });
    await registrar(cuenta, from, 'admin_wa.estatus', 'general', { resultado: bus.errores.length ? 'con_errores' : 'ok' });
    return mensajeEstatusGeneral(bus, cola);
  }

  if (cmd.tipo === 'aprobar') {
    try {
      await aprobarPieza(cmd.id, cuenta.userId);
      await registrar(cuenta, from, 'admin_wa.aprobar', cmd.id, { resultado: 'aprobada', cola: 'cola_aprobacion' });
      return `✅ Aprobé el envío pendiente ${cmd.id}. Sigue pendiente mandarlo — eso se hace en /admin/aprobaciones.`;
    } catch (eCola) {
      if (!(eCola instanceof DatoInvalido)) {
        const msg = mensajeParaPantalla(eCola, 'aprobar la pieza');
        await registrar(cuenta, from, 'admin_wa.aprobar', cmd.id, { resultado: 'error', err: msg });
        return msg;
      }
      // No estaba pendiente en `cola_aprobacion` (o no existe ahí) — se
      // prueba la OTRA cola de aprobación antes de darla por perdida.
      try {
        await resolverPieza(cmd.id, 'aprobada', cuenta.email);
        await registrar(cuenta, from, 'admin_wa.aprobar', cmd.id, { resultado: 'aprobada', cola: 'bus_pieza' });
        return `✅ Aprobé la pieza de rutina ${cmd.id}. La Mac la toma en su siguiente latido.`;
      } catch {
        await registrar(cuenta, from, 'admin_wa.aprobar', cmd.id, { resultado: 'no_encontrada' });
        return `No encontré una pieza pendiente con id "${cmd.id}" — ni en envíos ni en piezas de rutina. Revisa el id en el panel.`;
      }
    }
  }

  // cmd.tipo === 'correr'
  let bus: EstadoBus;
  try {
    bus = await getEstadoBus();
  } catch (e) {
    logger.error('admin_wa.correr_estatus_error', { err: e instanceof Error ? e.message : String(e) });
    return 'No pude confirmar el catálogo de rutinas ahorita — inténtalo de nuevo en un momento.';
  }
  if (!bus.rutinas.some((r) => r.nombre === cmd.rutina)) {
    const disponibles = bus.rutinas.map((r) => r.nombre).slice(0, 15).join(', ') || '(catálogo vacío)';
    await registrar(cuenta, from, 'admin_wa.correr', cmd.rutina, { resultado: 'no_encontrada' });
    return `No encontré la rutina "${cmd.rutina}". Rutinas disponibles: ${disponibles}.`;
  }
  try {
    await crearOrden('correr_ahora', cmd.rutina, cuenta.email);
    await registrar(cuenta, from, 'admin_wa.correr', cmd.rutina, { resultado: 'encolada' });
    return `✅ Encolé "correr ahora" para ${cmd.rutina}. La Mac la toma en su siguiente latido (≤5 min).`;
  } catch (e) {
    const msg = mensajeParaPantalla(e, 'encolar la rutina');
    await registrar(cuenta, from, 'admin_wa.correr', cmd.rutina, { resultado: 'error', err: msg });
    return msg;
  }
}
