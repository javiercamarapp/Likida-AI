// ═══════════════════════════════════════════════════════════════════════════
// EL MOTOR OAUTH DEL SERVIDOR MCP — emite y valida lo que las rutas firman.
//
// Likida es aquí las DOS cosas del RFC: el servidor de autorización (emite
// códigos y tokens contra la identidad del panel) y el servidor de recurso
// (/api/mcp valida esos tokens). No hay un tercero: la identidad es la de
// Supabase Auth que ya existe, y el consentimiento ocurre en /mcp/autorizar
// con la sesión del panel.
//
// ── LAS TRES REGLAS DE ESTE ARCHIVO ──────────────────────────────────────
//
// 1. NINGÚN secreto se guarda en claro. Códigos y tokens se guardan por su
//    SHA-256 (mismo criterio y mismas funciones que `auth/llave-api.ts`);
//    la migración 0260 tiene un CHECK que hace fallar el insert si alguien
//    intentara guardar el secreto entero.
// 2. TODO nace atado a (tenant, usuario, rol). No existe el token global:
//    el que valida recibe la flota YA resuelta, no una llave para resolverla.
// 3. Fallar cerrado Y DISTINTO: una credencial inválida es `no_valido`
//    (401 con el mismo texto siempre, para no regalar cuál mitad acertó);
//    una base que no contesta es `no_disponible` (503) — confundirlas haría
//    que Claude descartara un token bueno por un bache de red.
//
// PKCE es S256 y es OBLIGATORIO (OAuth 2.1 §7.5.2): sin challenge no hay
// código, y `plain` no se acepta. Claude y ChatGPT lo mandan siempre.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { hashDeLlave } from '@/lib/auth/llave-api';
import { appUrl } from '@/lib/env';

// ── Los tiempos ────────────────────────────────────────────────────────────

/** Un código de autorización vive MINUTOS: es un pase de mano en mano. */
export const CODIGO_TTL_MS = 5 * 60_000;
/** Un token de acceso vive horas: si se filtra, caduca solo el mismo día. */
export const ACCESO_TTL_MS = 8 * 60 * 60_000;
/** El refresco vive semanas y ROTA en cada uso: el robado se detecta al
 *  segundo canje y tumba la familia entera. */
export const REFRESCO_TTL_MS = 60 * 24 * 60 * 60_000;

// ── Las formas ─────────────────────────────────────────────────────────────
//
// Prefijos reconocibles a la vista y por escáneres de secretos, como
// `lk_live_` en las llaves de API. Tres prefijos distintos para que un log o
// un pegado accidental diga QUÉ se filtró sin enseñar el resto.

export const PREFIJO_CODIGO = 'lk_mcp_ac_';
export const PREFIJO_ACCESO = 'lk_mcp_at_';
export const PREFIJO_REFRESCO = 'lk_mcp_rt_';

export const SCOPE_LECTURA = 'likida.lectura';

/** El identificador canónico del recurso protegido (RFC 8707). */
export function recursoCanonico(): string {
  return `${appUrl()}/api/mcp`;
}

function secreto(prefijo: string): string {
  return `${prefijo}${randomBytes(32).toString('base64url')}`;
}

/** El S256 de PKCE: base64url(sha256(verifier)), RFC 7636 §4.2. */
export function retoS256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

// ── Redirect URIs ──────────────────────────────────────────────────────────

/**
 * ¿Esta redirect_uri se puede registrar?
 *
 * HTTPS para el mundo (Claude manda https://claude.ai/api/mcp/auth_callback;
 * ChatGPT su equivalente), y HTTP solo hacia loopback — Claude Code corre su
 * flujo en la máquina del usuario con un puerto efímero (RFC 8252 §7.3), y
 * exigirle TLS a localhost no protege nada.
 *
 * Nada de esquemas custom (`myapp://`): no hay cliente conocido que lo
 * necesite y son el vector clásico de intercepción en móvil.
 */
export function redirectUriAceptable(cruda: string): boolean {
  let u: URL;
  try {
    u = new URL(cruda);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') {
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname === '::1';
  }
  return false;
}

/**
 * ¿La URI pedida está entre las registradas?
 *
 * Comparación EXACTA, carácter por carácter (OAuth 2.1 §4.1.1), con UNA
 * excepción deliberada: para loopback (RFC 8252 §7.3) el PUERTO es libre,
 * porque Claude Code registra `http://localhost/callback` y luego escucha en
 * el puerto efímero que el sistema le dé. Host, esquema y ruta siguen
 * teniendo que coincidir exactos.
 */
export function redirectUriRegistrada(pedida: string, registradas: readonly string[]): boolean {
  if (registradas.includes(pedida)) return true;
  let p: URL;
  try {
    p = new URL(pedida);
  } catch {
    return false;
  }
  const esLoopback = p.protocol === 'http:' && (p.hostname === 'localhost' || p.hostname === '127.0.0.1' || p.hostname === '[::1]');
  if (!esLoopback) return false;
  return registradas.some((r) => {
    let u: URL;
    try {
      u = new URL(r);
    } catch {
      return false;
    }
    return u.protocol === p.protocol && u.hostname === p.hostname && u.pathname === p.pathname && u.search === p.search;
  });
}

// ── Resultados por valor ───────────────────────────────────────────────────

export type FalloOauth =
  /** La credencial o la petición no valen. Texto único a propósito. */
  | { ok: false; error: 'no_valido'; detalle: string }
  /** La base no contestó: NO es un 401. */
  | { ok: false; error: 'no_disponible'; detalle: string };

// ── Registro dinámico de clientes (RFC 7591) ───────────────────────────────

export interface ClienteRegistrado {
  clientId: string;
  nombre: string | null;
  redirectUris: string[];
}

export type ResultadoRegistro = { ok: true; cliente: ClienteRegistrado } | FalloOauth;

export async function registrarCliente(nombre: unknown, redirectUris: unknown): Promise<ResultadoRegistro> {
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 10) {
    return { ok: false, error: 'no_valido', detalle: 'redirect_uris tiene que ser una lista de 1 a 10 URIs.' };
  }
  const uris: string[] = [];
  for (const cruda of redirectUris) {
    if (typeof cruda !== 'string' || cruda.length > 500 || !redirectUriAceptable(cruda)) {
      return { ok: false, error: 'no_valido', detalle: 'Cada redirect_uri tiene que ser HTTPS (o HTTP solo hacia localhost), sin credenciales en la URL.' };
    }
    uris.push(cruda);
  }
  const nombreLimpio = typeof nombre === 'string' && nombre.trim().length > 0 ? nombre.trim().slice(0, 120) : null;

  const { data, error } = await supabaseAdmin()
    .from('mcp_oauth_cliente')
    .insert({ nombre: nombreLimpio, redirect_uris: uris })
    .select('id')
    .single();
  if (error || !data) {
    logger.error('mcp.oauth.registro', { err: error?.message ?? 'sin fila' });
    return { ok: false, error: 'no_disponible', detalle: 'No se pudo registrar el cliente. Intenta de nuevo.' };
  }
  return { ok: true, cliente: { clientId: String(data.id), nombre: nombreLimpio, redirectUris: uris } };
}

export async function leerCliente(clientId: string): Promise<{ ok: true; cliente: ClienteRegistrado } | FalloOauth> {
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
    return { ok: false, error: 'no_valido', detalle: 'client_id desconocido.' };
  }
  const { data, error } = await supabaseAdmin()
    .from('mcp_oauth_cliente')
    .select('id, nombre, redirect_uris')
    .eq('id', clientId)
    .maybeSingle();
  if (error) {
    logger.error('mcp.oauth.cliente_lectura', { err: error.message });
    return { ok: false, error: 'no_disponible', detalle: 'No se pudo leer el registro del cliente. Intenta de nuevo.' };
  }
  if (!data) return { ok: false, error: 'no_valido', detalle: 'client_id desconocido.' };
  const uris = Array.isArray(data.redirect_uris) ? data.redirect_uris.map(String) : [];
  return { ok: true, cliente: { clientId: String(data.id), nombre: (data.nombre as string) ?? null, redirectUris: uris } };
}

// ── La identidad congelada al consentir ────────────────────────────────────

export interface Consentimiento {
  clientId: string;
  userId: string;
  userEmail: string | null;
  tenantId: string;
  rol: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string | null;
}

export type ResultadoCodigo = { ok: true; codigo: string } | FalloOauth;

/** Emite el código de autorización. Lo llama SOLO la pantalla de
 *  consentimiento, ya con la sesión verificada y el botón apretado. */
export async function emitirCodigo(c: Consentimiento): Promise<ResultadoCodigo> {
  const codigo = secreto(PREFIJO_CODIGO);
  const { error } = await supabaseAdmin().from('mcp_oauth_codigo').insert({
    codigo_hash: hashDeLlave(codigo),
    cliente_id: c.clientId,
    user_id: c.userId,
    user_email: c.userEmail,
    tenant_id: c.tenantId,
    rol: c.rol,
    redirect_uri: c.redirectUri,
    code_challenge: c.codeChallenge,
    scope: SCOPE_LECTURA,
    resource: c.resource,
    familia: randomUUID(),
    expira_en: new Date(Date.now() + CODIGO_TTL_MS).toISOString(),
  });
  if (error) {
    logger.error('mcp.oauth.codigo_emision', { err: error.message });
    return { ok: false, error: 'no_disponible', detalle: 'No se pudo emitir la autorización. Intenta de nuevo.' };
  }

  // Sello de último uso del CLIENTE (no del token): best-effort, igual que
  // el de `validarAcceso`. Es lo que la 0260 prometió ("para poder podarlas")
  // y nadie escribía — `mantener_mcp_oauth` (0265) purga por "nunca produjo
  // un token", que no depende de esta columna, pero dejarla en null para
  // siempre en un cliente SÍ usado sería una promesa de la 0260 incumplida.
  void supabaseAdmin()
    .from('mcp_oauth_cliente')
    .update({ ultimo_uso_en: new Date().toISOString() })
    .eq('id', c.clientId)
    .then(({ error: e }) => { if (e) logger.warn('mcp.oauth.cliente_sello', { err: e.message }); });

  return { ok: true, codigo };
}

// ── El canje: código → par de tokens ───────────────────────────────────────

export interface ParTokens {
  acceso: string;
  refresco: string;
  /** Segundos de vida del acceso, para `expires_in`. */
  expiraEnSegundos: number;
  scope: string;
}

export type ResultadoCanje = { ok: true; tokens: ParTokens } | FalloOauth;

/** El texto ÚNICO del 401 de canje. Distinguir «no existe» de «expiró» de
 *  «verifier mal» le diría a quien prueba códigos cuál mitad acertó. */
const CANJE_INVALIDO = 'El código de autorización no es válido, ya se usó o expiró.';

interface FilaCodigo {
  id: string;
  cliente_id: string;
  user_id: string;
  user_email: string | null;
  tenant_id: string;
  rol: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string | null;
  familia: string;
  expira_en: string;
  usado_en: string | null;
}

async function emitirPar(
  f: Pick<FilaCodigo, 'cliente_id' | 'user_id' | 'user_email' | 'tenant_id' | 'rol' | 'familia'>,
): Promise<ResultadoCanje> {
  const acceso = secreto(PREFIJO_ACCESO);
  const refresco = secreto(PREFIJO_REFRESCO);
  const ahora = Date.now();
  const base = {
    cliente_id: f.cliente_id,
    user_id: f.user_id,
    user_email: f.user_email,
    tenant_id: f.tenant_id,
    rol: f.rol,
    familia: f.familia,
  };
  const { error } = await supabaseAdmin().from('mcp_oauth_token').insert([
    { ...base, token_hash: hashDeLlave(acceso), tipo: 'acceso', expira_en: new Date(ahora + ACCESO_TTL_MS).toISOString() },
    { ...base, token_hash: hashDeLlave(refresco), tipo: 'refresco', expira_en: new Date(ahora + REFRESCO_TTL_MS).toISOString() },
  ]);
  if (error) {
    logger.error('mcp.oauth.token_emision', { err: error.message });
    return { ok: false, error: 'no_disponible', detalle: 'No se pudieron emitir los tokens. Intenta de nuevo.' };
  }
  return {
    ok: true,
    tokens: { acceso, refresco, expiraEnSegundos: Math.floor(ACCESO_TTL_MS / 1000), scope: SCOPE_LECTURA },
  };
}

/** Revoca la familia entera. Best-effort: se usa al detectar reuso, y el
 *  fallo se loguea sin tumbar la respuesta (que ya va a ser un 401). */
async function revocarFamilia(familia: string, motivo: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('mcp_oauth_token')
    .update({ revocado_en: new Date().toISOString() })
    .eq('familia', familia)
    .is('revocado_en', null);
  if (error) logger.error('mcp.oauth.revocar_familia', { motivo, err: error.message });
  else logger.warn('mcp.oauth.familia_revocada', { motivo });
}

export async function canjearCodigo(
  codigo: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<ResultadoCanje> {
  if (!codigo.startsWith(PREFIJO_CODIGO)) {
    return { ok: false, error: 'no_valido', detalle: CANJE_INVALIDO };
  }
  const { data, error } = await supabaseAdmin()
    .from('mcp_oauth_codigo')
    .select('id, cliente_id, user_id, user_email, tenant_id, rol, redirect_uri, code_challenge, resource, familia, expira_en, usado_en')
    .eq('codigo_hash', hashDeLlave(codigo))
    .maybeSingle();
  if (error) {
    logger.error('mcp.oauth.canje_lectura', { err: error.message });
    return { ok: false, error: 'no_disponible', detalle: 'No se pudo verificar el código. Intenta de nuevo.' };
  }
  if (!data) return { ok: false, error: 'no_valido', detalle: CANJE_INVALIDO };
  const fila = data as FilaCodigo;

  // Reuso = robo (RFC 6749 §4.1.2): el segundo canje no solo se niega — tumba
  // lo que el primero emitió.
  if (fila.usado_en !== null) {
    await revocarFamilia(fila.familia, 'codigo_reusado');
    return { ok: false, error: 'no_valido', detalle: CANJE_INVALIDO };
  }
  if (fila.cliente_id !== clientId) return { ok: false, error: 'no_valido', detalle: CANJE_INVALIDO };
  if (Date.parse(fila.expira_en) <= Date.now()) return { ok: false, error: 'no_valido', detalle: CANJE_INVALIDO };
  if (fila.redirect_uri !== redirectUri) return { ok: false, error: 'no_valido', detalle: CANJE_INVALIDO };
  if (typeof codeVerifier !== 'string' || codeVerifier.length < 43 || codeVerifier.length > 128) {
    return { ok: false, error: 'no_valido', detalle: CANJE_INVALIDO };
  }
  if (retoS256(codeVerifier) !== fila.code_challenge) {
    return { ok: false, error: 'no_valido', detalle: CANJE_INVALIDO };
  }

  // Marcar usado con la condición EN la base: dos canjes simultáneos del mismo
  // código compiten por este UPDATE y solo uno encuentra la fila con
  // `usado_en` null. El perdedor recibe cero filas y se niega.
  const marcado = await supabaseAdmin()
    .from('mcp_oauth_codigo')
    .update({ usado_en: new Date().toISOString() })
    .eq('id', fila.id)
    .is('usado_en', null)
    .select('id');
  if (marcado.error) {
    logger.error('mcp.oauth.canje_marca', { err: marcado.error.message });
    return { ok: false, error: 'no_disponible', detalle: 'No se pudo canjear el código. Intenta de nuevo.' };
  }
  if (!marcado.data || marcado.data.length === 0) {
    await revocarFamilia(fila.familia, 'codigo_carrera');
    return { ok: false, error: 'no_valido', detalle: CANJE_INVALIDO };
  }

  // Limpieza best-effort de códigos ya inservibles (expirados hace más de un
  // día). No condiciona la respuesta.
  void supabaseAdmin()
    .from('mcp_oauth_codigo')
    .delete()
    .lt('expira_en', new Date(Date.now() - 24 * 60 * 60_000).toISOString())
    .then(({ error: e }) => { if (e) logger.warn('mcp.oauth.limpieza_codigos', { err: e.message }); });

  return emitirPar(fila);
}

// ── El refresco: rotación con detección de reuso ───────────────────────────

const REFRESCO_INVALIDO = 'El token de refresco no es válido, ya rotó o expiró. Vuelve a conectar Likida desde tu cliente.';

export async function refrescarTokens(refresco: string, clientId: string): Promise<ResultadoCanje> {
  if (!refresco.startsWith(PREFIJO_REFRESCO)) {
    return { ok: false, error: 'no_valido', detalle: REFRESCO_INVALIDO };
  }
  const { data, error } = await supabaseAdmin()
    .from('mcp_oauth_token')
    .select('id, cliente_id, user_id, user_email, tenant_id, rol, familia, expira_en, revocado_en, tipo')
    .eq('token_hash', hashDeLlave(refresco))
    .maybeSingle();
  if (error) {
    logger.error('mcp.oauth.refresco_lectura', { err: error.message });
    return { ok: false, error: 'no_disponible', detalle: 'No se pudo verificar el token. Intenta de nuevo.' };
  }
  if (!data || data.tipo !== 'refresco') return { ok: false, error: 'no_valido', detalle: REFRESCO_INVALIDO };
  if (data.cliente_id !== clientId) return { ok: false, error: 'no_valido', detalle: REFRESCO_INVALIDO };

  // Un refresco YA ROTADO que vuelve a aparecer es la señal de robo: tumba la
  // familia entera (OAuth 2.1 §4.3.1).
  if (data.revocado_en !== null) {
    await revocarFamilia(String(data.familia), 'refresco_reusado');
    return { ok: false, error: 'no_valido', detalle: REFRESCO_INVALIDO };
  }
  if (Date.parse(String(data.expira_en)) <= Date.now()) {
    return { ok: false, error: 'no_valido', detalle: REFRESCO_INVALIDO };
  }

  // AUDITORÍA FINAL 2026-08-29, HALLAZGO 1: la identidad congelada en el
  // token (tenant_id, rol) puede llevar meses sin ser cierta — un usuario
  // dado de baja o con el rol cambiado en `app_user` no borra su fila (el FK
  // cascade sí la borraría, pero nada en el producto hace la baja hoy). Sin
  // esto, cada rotación renovaba el refresco otros 60 días para siempre.
  // Se revalida contra la base ANTES de rotar, y un desajuste se trata
  // EXACTAMENTE como el reuso de un refresco: se tumba la familia entera y
  // se contesta el mismo `invalid_grant` (mcp_oauth_usuario_vigente, 0265).
  const vigente = await supabaseAdmin().rpc('mcp_oauth_usuario_vigente', {
    p_user_id: data.user_id,
    p_tenant_id: data.tenant_id,
    p_rol: data.rol,
  });
  if (vigente.error) {
    logger.error('mcp.oauth.revalidacion', { err: vigente.error.message });
    return { ok: false, error: 'no_disponible', detalle: 'No se pudo verificar el usuario. Intenta de nuevo.' };
  }
  if (vigente.data !== true) {
    await revocarFamilia(String(data.familia), 'usuario_no_vigente');
    return { ok: false, error: 'no_valido', detalle: REFRESCO_INVALIDO };
  }

  // Rotar = revocar ESTE refresco con condición en la base (mismo patrón de
  // carrera que el canje del código) y emitir el par nuevo.
  const marcado = await supabaseAdmin()
    .from('mcp_oauth_token')
    .update({ revocado_en: new Date().toISOString() })
    .eq('id', data.id)
    .is('revocado_en', null)
    .select('id');
  if (marcado.error) {
    logger.error('mcp.oauth.refresco_marca', { err: marcado.error.message });
    return { ok: false, error: 'no_disponible', detalle: 'No se pudo rotar el token. Intenta de nuevo.' };
  }
  if (!marcado.data || marcado.data.length === 0) {
    await revocarFamilia(String(data.familia), 'refresco_carrera');
    return { ok: false, error: 'no_valido', detalle: REFRESCO_INVALIDO };
  }

  return emitirPar({
    cliente_id: String(data.cliente_id),
    user_id: String(data.user_id),
    user_email: (data.user_email as string) ?? null,
    tenant_id: String(data.tenant_id),
    rol: String(data.rol),
    familia: String(data.familia),
  });
}

// ── Validar un acceso (el camino caliente de /api/mcp) ─────────────────────

export interface AccesoMcp {
  tokenId: string;
  tenantId: string;
  userId: string;
  userEmail: string | null;
  rol: string;
}

export type ResultadoAcceso = { ok: true; acceso: AccesoMcp } | FalloOauth;

const ACCESO_INVALIDO = 'Token inválido o expirado.';

export async function validarAcceso(token: string): Promise<ResultadoAcceso> {
  if (!token.startsWith(PREFIJO_ACCESO)) {
    return { ok: false, error: 'no_valido', detalle: ACCESO_INVALIDO };
  }
  const { data, error } = await supabaseAdmin()
    .from('mcp_oauth_token')
    .select('id, tipo, user_id, user_email, tenant_id, rol, expira_en, revocado_en')
    .eq('token_hash', hashDeLlave(token))
    .maybeSingle();
  if (error) {
    logger.error('mcp.oauth.acceso_lectura', { err: error.message });
    return { ok: false, error: 'no_disponible', detalle: 'No se pudo verificar el token. Intenta de nuevo.' };
  }
  if (!data || data.tipo !== 'acceso') return { ok: false, error: 'no_valido', detalle: ACCESO_INVALIDO };
  if (data.revocado_en !== null) return { ok: false, error: 'no_valido', detalle: ACCESO_INVALIDO };
  if (Date.parse(String(data.expira_en)) <= Date.now()) {
    return { ok: false, error: 'no_valido', detalle: ACCESO_INVALIDO };
  }

  // Sello de último uso: best-effort, igual que en `resolverLlave`.
  void supabaseAdmin()
    .from('mcp_oauth_token')
    .update({ ultimo_uso_en: new Date().toISOString() })
    .eq('id', data.id)
    .then(({ error: e }) => { if (e) logger.warn('mcp.oauth.sello', { err: e.message }); });

  return {
    ok: true,
    acceso: {
      tokenId: String(data.id),
      tenantId: String(data.tenant_id),
      userId: String(data.user_id),
      userEmail: (data.user_email as string) ?? null,
      rol: String(data.rol),
    },
  };
}
