import { createHash, randomBytes } from 'node:crypto';
import { comercio as fichaComercio } from '../facturacion/comercios';
import { recortarEstadoAlPortal } from '../facturacion/vinculo_senales';

// ═══════════════════════════════════════════════════════════════════════════
// LA VINCULACIÓN ASISTIDA DESDE EL PANEL — el paso humano del CAPTCHA/MFA con
// pantalla en el producto (agente 6, 0540).
//
// EL PROBLEMA. Crear la sesión de un portal con login pasa obligatoriamente por una
// persona (CAPTCHA, código de dos pasos): Likida no los resuelve ni los rodea. Hasta
// hoy ese paso era `scripts/vincular-portal.mjs <tenant> <portal>` con llaves de
// servicio en la máquina del contralor y sin ninguna pantalla en el producto.
//
// EL DISEÑO (honesto sobre lo que un servidor de Vercel NO puede hacer: enseñarle a
// alguien un Chromium para que teclee en él).
//
//   1. El dueño pulsa «Vincular» en el panel → `iniciarVinculacion` crea una solicitud
//      con un CÓDIGO DE UN SOLO USO (80 bits; se muestra una vez; en la base solo vive
//      su SHA-256) que caduca en 15 min.
//   2. En la máquina CON PANTALLA del contralor se corre
//      `npx tsx scripts/vincular-portal.mjs --codigo XXXX-XXXX-XXXX-XXXX`. El script no
//      lleva llaves de Likida: presenta el código por HTTPS (`/api/vinculacion-portal`).
//   3. `reclamarVinculacion` consume el código (atómico en la base: una sola máquina lo
//      gana) y devuelve QUÉ portal abrir. El script abre un Chromium VISIBLE; la persona
//      entra, resuelve el reto y el script NO teclea nada: solo espera a que desaparezca
//      la pantalla de entrar (`vinculacion_asistida.ts`).
//   4. El script sube SOLO las cookies de ese portal (`completarVinculacion`): el servidor
//      las vuelve a recortar al dominio del portal, las cifra en el cofre (AES-256-GCM),
//      anota «vinculado» y cierra la solicitud. La contraseña del portal no pasa por Likida.
//
// Caducidad y re-vinculación: la sesión caduca cuando el portal la cierra; el cron de
// facturar la detecta (`invalidarVinculo` → «caducada»), el tablero lo grita y el mismo botón
// la renueva. Una solicitud sin completar caduca sola y se purga (`purgar_vinculacion_portal`).
//
// TODO LO QUE TOCA LA BASE ENTRA POR PUERTOS (`RepoVinculacion`, `SalidasVinculacion`):
// la prueba E2E corre el ciclo completo con dobles, y la implementación real
// (`vinculacion_remota_repo.ts`) vive aparte.
// ═══════════════════════════════════════════════════════════════════════════

/** Minutos que vive un código antes de caducar. */
export const VIGENCIA_CODIGO_MIN = 15;
/** Tope del cuerpo que sube la máquina del contralor: un storageState normal pesa < 50 KB. */
export const MAX_ESTADO_BYTES = 200_000;

export type EstadoSolicitud = 'pendiente' | 'reclamada' | 'completada' | 'fallida' | 'expirada' | 'cancelada';

export interface SolicitudVinculacion {
  id: string;
  tenantId: string;
  comercio: string;
  estado: EstadoSolicitud;
  creadaEn: string;
  expiraEn: string;
  reclamadaEn: string | null;
  cerradaEn: string | null;
  cookies: number | null;
  motivo: string | null;
}

export interface RepoVinculacion {
  crear(a: { tenantId: string; comercio: string; userId: string; hash: string; ttlMin: number }): Promise<{ ok: true; id: string } | { ok: false; motivo: string }>;
  reclamar(hash: string): Promise<{ ok: true; id: string; tenantId: string; comercio: string; expiraEn: string } | { ok: false; motivo: string }>;
  /** La solicitud reclamada con ese código (para completarla), o null. */
  reclamadaPorHash(hash: string): Promise<{ id: string; tenantId: string; comercio: string; expiraEn: string } | null>;
  cerrar(a: { id: string; tenantId: string; estado: 'completada' | 'fallida'; cookies?: number; motivo?: string }): Promise<{ ok: boolean; motivo?: string }>;
  cancelar(tenantId: string, comercio: string): Promise<number>;
  /** `null` = la base no contestó (la pantalla lo dice; no pinta «ninguna»). */
  listar(tenantId: string): Promise<SolicitudVinculacion[] | null>;
}

export interface SalidasVinculacion {
  /** Cifra y guarda la sesión del portal (lanza si el cofre no está configurado). */
  guardarSesion(tenantId: string, comercio: string, storageState: string, capturadaEn: string): Promise<void>;
  /** Escribe «vinculado» en `portal_estado`. Best-effort. */
  anotarVinculado(tenantId: string, comercio: string, ahora: string): Promise<void>;
  /** Bitácora de auditoría (sin cookies ni códigos). */
  bitacora(tenantId: string, actor: { id?: string | null } | 'sistema', accion: string, comercio: string, detalle: Record<string, unknown>): Promise<void>;
}

export interface DepsVinculacion {
  repo: RepoVinculacion;
  salidas: SalidasVinculacion;
  ahora?: () => Date;
  /** Para pruebas: bytes aleatorios deterministas. */
  bytesAleatorios?: (n: number) => Buffer;
}

// ── El código ───────────────────────────────────────────────────────────────

// Crockford: sin I, L, O, U (no se confunden al dictarlos).
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 16 símbolos base32 = 80 bits, en grupos de 4: XXXX-XXXX-XXXX-XXXX. */
export function generarCodigo(bytes: (n: number) => Buffer = randomBytes): string {
  const b = bytes(10);
  let bits = '';
  for (const x of b) bits += x.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < 80; i += 5) out += ALFABETO[parseInt(bits.slice(i, i + 5), 2)];
  return out.match(/.{4}/g)!.join('-');
}

/** Normaliza lo que alguien teclea o pega: mayúsculas, sin separadores, O→0, I/L→1 (Crockford). */
export function normalizarCodigo(crudo: string): string | null {
  const limpio = crudo.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(limpio) ? limpio : null;
}

export function hashCodigo(crudo: string): string | null {
  const n = normalizarCodigo(crudo);
  return n === null ? null : createHash('sha256').update(n).digest('hex');
}

// ── 1. Iniciar (el panel) ───────────────────────────────────────────────────

export type ResultadoIniciar =
  | { ok: true; codigo: string; expiraEn: string; comando: string; comercio: string; nombre: string }
  | { ok: false; motivo: string };

/** ¿Este comercio se vincula con sesión asistida? Los que piden cuenta, o cuyo guion exige sesión. */
export function vinculable(clave: string): boolean {
  const f = fichaComercio(clave);
  return f !== null && f !== undefined && f.requiereCuenta === true;
}

export async function iniciarVinculacion(
  a: { tenantId: string; userId: string; comercio: string },
  deps: DepsVinculacion,
): Promise<ResultadoIniciar> {
  const ficha = fichaComercio(a.comercio);
  if (!ficha) return { ok: false, motivo: 'Ese portal no está en el catálogo.' };
  if (!vinculable(a.comercio)) {
    return { ok: false, motivo: `${ficha.nombre} no pide cuenta: no hay sesión que vincular, Likida lo factura con los datos del ticket.` };
  }
  const codigo = generarCodigo(deps.bytesAleatorios);
  const hash = hashCodigo(codigo)!;
  const r = await deps.repo.crear({ tenantId: a.tenantId, comercio: a.comercio, userId: a.userId, hash, ttlMin: VIGENCIA_CODIGO_MIN });
  if (!r.ok) return { ok: false, motivo: r.motivo };
  const ahora = (deps.ahora ?? (() => new Date()))();
  const expiraEn = new Date(ahora.getTime() + VIGENCIA_CODIGO_MIN * 60_000).toISOString();
  await deps.salidas.bitacora(a.tenantId, { id: a.userId }, 'autofactura.vinculacion_iniciada', a.comercio, { solicitud: r.id });
  return {
    ok: true, codigo, expiraEn, comercio: a.comercio, nombre: ficha.nombre,
    comando: `npx tsx scripts/vincular-portal.mjs --codigo ${codigo}`,
  };
}

// ── 2. Reclamar (la máquina con pantalla) ───────────────────────────────────

export type ResultadoReclamo =
  | { ok: true; solicitudId: string; comercio: string; nombre: string; portal: string; expiraEn: string }
  | { ok: false; motivo: string };

export async function reclamarVinculacion(codigo: string, deps: DepsVinculacion): Promise<ResultadoReclamo> {
  const huella = hashCodigo(codigo);
  if (huella === null) return { ok: false, motivo: 'El código no tiene la forma XXXX-XXXX-XXXX-XXXX.' };
  const r = await deps.repo.reclamar(huella);
  if (!r.ok) return { ok: false, motivo: r.motivo };
  const ficha = fichaComercio(r.comercio);
  if (!ficha) {
    await deps.repo.cerrar({ id: r.id, tenantId: r.tenantId, estado: 'fallida', motivo: 'el portal ya no está en el catálogo' });
    return { ok: false, motivo: 'Ese portal ya no está en el catálogo.' };
  }
  await deps.salidas.bitacora(r.tenantId, 'sistema', 'autofactura.vinculacion_reclamada', r.comercio, { solicitud: r.id });
  return { ok: true, solicitudId: r.id, comercio: r.comercio, nombre: ficha.nombre, portal: ficha.portal, expiraEn: r.expiraEn };
}

// ── 3. Completar / fallar (la máquina con pantalla sube la sesión) ──────────

export type ResultadoCompletar =
  | { ok: true; comercio: string; cookies: number }
  | { ok: false; motivo: string };

export async function completarVinculacion(
  a: { codigo: string; storageState: string },
  deps: DepsVinculacion,
): Promise<ResultadoCompletar> {
  const huella = hashCodigo(a.codigo);
  if (huella === null) return { ok: false, motivo: 'El código no tiene la forma XXXX-XXXX-XXXX-XXXX.' };
  const sol = await deps.repo.reclamadaPorHash(huella);
  if (sol === null) return { ok: false, motivo: 'No hay una vinculación en curso con ese código (venció, ya se completó o se canceló).' };
  const ahora = (deps.ahora ?? (() => new Date()))();
  if (Date.parse(sol.expiraEn) <= ahora.getTime()) {
    await deps.repo.cerrar({ id: sol.id, tenantId: sol.tenantId, estado: 'completada', cookies: 0 }); // la base la marca expirada
    return { ok: false, motivo: 'El código venció antes de terminar. Pide otro en el panel.' };
  }

  const fallar = async (motivo: string): Promise<ResultadoCompletar> => {
    await deps.repo.cerrar({ id: sol.id, tenantId: sol.tenantId, estado: 'fallida', motivo });
    await deps.salidas.bitacora(sol.tenantId, 'sistema', 'autofactura.vinculacion_fallida', sol.comercio, { solicitud: sol.id, motivo });
    return { ok: false, motivo };
  };

  if (Buffer.byteLength(a.storageState, 'utf8') > MAX_ESTADO_BYTES) return fallar('La sesión subida es demasiado grande para ser la de un portal.');
  const ficha = fichaComercio(sol.comercio);
  if (!ficha) return fallar('El portal ya no está en el catálogo.');

  // El servidor NO se fía de lo que sube la máquina: la vuelve a recortar al dominio del
  // portal. Cookies de otros sitios (el correo del contralor, su banco) no se guardan.
  const recortado = recortarEstadoAlPortal(a.storageState, ficha.portal);
  if (recortado === null) return fallar(`La sesión subida no trae ninguna cookie de ${new URL(ficha.portal).hostname}: no hay nada que guardar.`);
  const cookies = (JSON.parse(recortado) as { cookies: unknown[] }).cookies.length;

  const capturadaEn = ahora.toISOString();
  try {
    await deps.salidas.guardarSesion(sol.tenantId, sol.comercio, recortado, capturadaEn);
  } catch (e) {
    return fallar(`No se pudo guardar la sesión cifrada: ${e instanceof Error ? e.message : String(e)}`);
  }
  const cierre = await deps.repo.cerrar({ id: sol.id, tenantId: sol.tenantId, estado: 'completada', cookies });
  if (!cierre.ok) {
    // La sesión ya quedó guardada pero la solicitud venció/cambió: se dice, no se finge éxito.
    return { ok: false, motivo: cierre.motivo ?? 'La solicitud ya no estaba en curso.' };
  }
  await deps.salidas.anotarVinculado(sol.tenantId, sol.comercio, capturadaEn);
  await deps.salidas.bitacora(sol.tenantId, 'sistema', 'autofactura.vinculacion_completada', sol.comercio, { solicitud: sol.id, cookies });
  return { ok: true, comercio: sol.comercio, cookies };
}

/** La máquina con pantalla avisa que no pudo (la persona no entró a tiempo, cerró la ventana…). */
export async function fallarVinculacion(a: { codigo: string; motivo: string }, deps: DepsVinculacion): Promise<{ ok: boolean }> {
  const huella = hashCodigo(a.codigo);
  if (huella === null) return { ok: false };
  const sol = await deps.repo.reclamadaPorHash(huella);
  if (sol === null) return { ok: false };
  const r = await deps.repo.cerrar({ id: sol.id, tenantId: sol.tenantId, estado: 'fallida', motivo: a.motivo.slice(0, 400) });
  if (r.ok) await deps.salidas.bitacora(sol.tenantId, 'sistema', 'autofactura.vinculacion_fallida', sol.comercio, { solicitud: sol.id, motivo: a.motivo.slice(0, 200) });
  return { ok: r.ok };
}

// ── 4. Cancelar (el panel) y leer el estado ─────────────────────────────────

export async function cancelarVinculacion(a: { tenantId: string; userId: string; comercio: string }, deps: DepsVinculacion): Promise<number> {
  const n = await deps.repo.cancelar(a.tenantId, a.comercio);
  if (n > 0) await deps.salidas.bitacora(a.tenantId, { id: a.userId }, 'autofactura.vinculacion_cancelada', a.comercio, {});
  return n;
}

/**
 * Lo que la pantalla enseña de la solicitud más reciente de un portal. Una viva vencida
 * se muestra como vencida aunque la base todavía no la haya cerrado (la cierra la
 * siguiente creación o la purga): la pantalla no puede ofrecer un código muerto.
 */
export function estadoVisible(s: SolicitudVinculacion | null, ahora: Date): EstadoSolicitud | 'ninguna' {
  if (s === null) return 'ninguna';
  if ((s.estado === 'pendiente' || s.estado === 'reclamada') && Date.parse(s.expiraEn) <= ahora.getTime()) return 'expirada';
  return s.estado;
}
