import { createHash } from 'node:crypto';
import { cifrar } from '../likida/conectores/cofre';
import { contextoCredencial } from '../likida/conectores/contexto_credencial';

// ═══════════════════════════════════════════════════════════════════════════
// NÚCLEO DEL ALTA DE UNA LÍNEA DE WHATSAPP (lo que corre `scripts/conectar-linea-whatsapp.mjs`).
//
// Vive aquí, y no en el .mjs, para poder probarlo: recibe TODO lo que toca el mundo (token, red, cifrado, salida) por `Dependencias`.
// Reutiliza el MISMO cofre v2 que `linea_repo.ts` (`cifrar` con contexto `${tenantId}:${phoneNumberId}`), sin importar `linea_repo`
// (que arrastra el cliente de Supabase y el logger de la app).
//
// EL TOKEN: lo entrega `leerToken` (un diálogo OCULTO de macOS en el script). Nunca viaja por argumentos ni por variables de entorno
// y nunca se imprime: toda la salida pasa por `redactar`, que además tapa cualquier aparición literal del token y de las llaves.
// Contra Meta solo se hacen LECTURAS (GET); contra la base, un insert (y, con --activar, un update y la rpc de principal).
// ═══════════════════════════════════════════════════════════════════════════

export const PROPOSITOS = ['servicio_cliente', 'operadores', 'oficina', 'general'] as const;
export type Proposito = (typeof PROPOSITOS)[number];

export type ArgsAlta = {
  tenantId: string;
  phoneNumberId: string;
  wabaId: string | null;
  numeroVisible: string | null;
  etiqueta: string | null;
  proposito: Proposito | null;
  terminalId: string | null;
  principal: boolean;
  activar: boolean;
  dryRun: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_META = /^\d{6,32}$/;
const BANDERAS = new Set(['--principal', '--activar', '--dry-run']);
const CON_VALOR = new Set(['--tenant', '--phone-number-id', '--waba-id', '--numero', '--etiqueta', '--proposito', '--terminal']);

export const USO = [
  'Uso: node scripts/conectar-linea-whatsapp.mjs --tenant <uuid> --phone-number-id <id> [opciones]',
  '  --tenant <uuid>            flota dueña de la línea (obligatorio)',
  '  --phone-number-id <id>     phone_number_id de Meta (obligatorio)',
  '  --waba-id <id>             cuenta de WhatsApp Business (obligatorio con --activar)',
  '  --numero <visible>         número como lo ve el cliente, p. ej. "+52 55 1234 5678"',
  '  --etiqueta <texto>         nombre para reconocer la línea',
  '  --proposito <p>            servicio_cliente | operadores | oficina | general',
  '  --terminal <uuid>          terminal a la que sirve la línea',
  '  --principal                línea por omisión de la flota',
  '  --activar                  tras verificar el webhook, pasa la línea a activa',
  '  --dry-run                  valida todo y no escribe nada',
  'El token permanente se pide en un diálogo oculto: nunca por argumentos.',
].join('\n');

export type ResultadoArgs = { ok: true; args: ArgsAlta } | { ok: false; error: string };

/** Valida los argumentos. Rechaza flags desconocidos y cualquier intento de pasar el token por la línea de comandos. */
export function parsearArgumentos(argv: readonly string[]): ResultadoArgs {
  const valores = new Map<string, string>();
  const banderas = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (/^--(token|access-token|secret)/i.test(a)) return { ok: false, error: 'El token no se pasa por argumentos: el script lo pide en un diálogo oculto.' };
    if (BANDERAS.has(a)) { banderas.add(a); continue; }
    if (CON_VALOR.has(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { ok: false, error: `Falta el valor de ${a}` };
      valores.set(a, v);
      i += 1;
      continue;
    }
    return { ok: false, error: `Argumento desconocido: ${a.startsWith('--') ? a : '(valor suelto)'}` };
  }

  const tenantId = valores.get('--tenant') ?? '';
  if (!UUID.test(tenantId)) return { ok: false, error: '--tenant debe ser un uuid' };
  const phoneNumberId = valores.get('--phone-number-id') ?? '';
  if (!ID_META.test(phoneNumberId)) return { ok: false, error: '--phone-number-id inválido (solo dígitos, 6 a 32)' };
  const wabaId = valores.get('--waba-id') ?? null;
  if (wabaId !== null && !ID_META.test(wabaId)) return { ok: false, error: '--waba-id inválido (solo dígitos, 6 a 32)' };
  const terminalId = valores.get('--terminal') ?? null;
  if (terminalId !== null && !UUID.test(terminalId)) return { ok: false, error: '--terminal debe ser un uuid' };
  const proposito = valores.get('--proposito') ?? null;
  if (proposito !== null && !(PROPOSITOS as readonly string[]).includes(proposito)) {
    return { ok: false, error: `--proposito debe ser uno de: ${PROPOSITOS.join(', ')}` };
  }
  const activar = banderas.has('--activar');
  if (activar && wabaId === null) return { ok: false, error: '--activar necesita --waba-id (la verificación del webhook se hace sobre esa cuenta)' };
  const etiqueta = valores.get('--etiqueta')?.trim() || null;
  if (etiqueta !== null && etiqueta.length > 80) return { ok: false, error: '--etiqueta pasa de 80 caracteres' };
  const numeroVisible = valores.get('--numero')?.trim() || null;
  if (numeroVisible !== null && numeroVisible.length > 40) return { ok: false, error: '--numero pasa de 40 caracteres' };

  return {
    ok: true,
    args: {
      tenantId: tenantId.toLowerCase(), phoneNumberId, wabaId, numeroVisible, etiqueta,
      proposito: proposito as Proposito | null, terminalId: terminalId?.toLowerCase() ?? null,
      principal: banderas.has('--principal'), activar, dryRun: banderas.has('--dry-run'),
    },
  };
}

export type Dependencias = {
  /** Entrega el token permanente (diálogo oculto). */
  leerToken: () => Promise<string>;
  fetch: typeof fetch;
  env: Readonly<Record<string, string | undefined>>;
  /** Salida visible (ya redactada por `ejecutarAlta`). */
  escribir: (linea: string) => void;
  /** Cifrado del cofre; por omisión el de la app (`cifrar` v2). Inyectable en pruebas. */
  cifrar?: (valores: { token: string }, contexto: string) => string;
};

export type ResultadoAlta = { codigo: 0 | 1 | 2; lineaId: string | null };

const GRAPH = 'https://graph.facebook.com/v21.0';
const UMBRAL_TOKEN = 16;

function leerEnv(env: Dependencias['env']): { url: string; llave: string } | null {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = env.SUPABASE_SERVICE_ROLE_KEY;
  return url && llave ? { url: url.replace(/\/+$/, ''), llave } : null;
}

type RespuestaMeta = { ok: boolean; status: number; json: Record<string, unknown> | null };

async function getMeta(f: typeof fetch, ruta: string, token: string): Promise<RespuestaMeta> {
  const res = await f(`${GRAPH}/${ruta}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  let json: Record<string, unknown> | null = null;
  try { json = (await res.json()) as Record<string, unknown>; } catch { json = null; }
  return { ok: res.ok, status: res.status, json };
}

/** Del error de Meta solo el código numérico: el cuerpo crudo puede traer el token. */
function codigoMeta(r: RespuestaMeta): string {
  const e = r.json?.error as { code?: unknown } | undefined;
  return typeof e?.code === 'number' ? `, código ${e.code}` : '';
}

const pistas = (token: string) => `…${token.slice(-4)}`;

/**
 * Corre el alta. Códigos: 0 = hecho (o dry-run válido); 1 = argumentos/entorno/validación/base (no se guardó nada, o se guardó pendiente
 * y se dice); 2 = la línea quedó guardada PENDIENTE porque no se pudo verificar el webhook para activarla.
 */
export async function ejecutarAlta(args: ArgsAlta, deps: Dependencias): Promise<ResultadoAlta> {
  let token = '';
  const secretos: string[] = [];
  const salida = (l: string) => {
    let t = l;
    for (const s of secretos) if (s) t = t.split(s).join('[oculto]');
    deps.escribir(t);
  };
  const falla = (m: string, codigo: 1 | 2 = 1, lineaId: string | null = null): ResultadoAlta => { salida(`ERROR: ${m}`); return { codigo, lineaId }; };

  const conexion = leerEnv(deps.env);
  if (!conexion) return falla('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  secretos.push(conexion.llave);
  const llaveCofre = deps.env.LIKIDA_COFRE_LLAVE;
  if (!llaveCofre || llaveCofre.length < 32) return falla('Falta LIKIDA_COFRE_LLAVE (mínimo 32 caracteres) en el entorno.');
  secretos.push(llaveCofre);
  if (deps.env.WHATSAPP_PHONE_NUMBER_ID && deps.env.WHATSAPP_PHONE_NUMBER_ID === args.phoneNumberId) {
    return falla('Ese número es el de la plataforma: no se registra como línea de una flota.');
  }

  try { token = (await deps.leerToken()).trim(); } catch { return falla('No se pudo leer el token (diálogo cancelado).'); }
  if (token.length < UMBRAL_TOKEN) return falla('El token está vacío o es demasiado corto.');
  secretos.push(token);

  // 1. Meta, solo lectura: el token debe poder leer ESE phone_number_id.
  let numeroMeta: Record<string, unknown> | null;
  try {
    const r = await getMeta(deps.fetch, `${encodeURIComponent(args.phoneNumberId)}?fields=id,display_phone_number,verified_name`, token);
    if (!r.ok || String(r.json?.id ?? '') !== args.phoneNumberId) {
      return falla(`Meta no validó el token para ese phone_number_id (HTTP ${r.status}${codigoMeta(r)}). No se guardó nada.`);
    }
    numeroMeta = r.json;
  } catch {
    return falla('No se pudo consultar a Meta. No se guardó nada.');
  }
  salida(`Meta validó el token. Número visible: ${String(numeroMeta?.display_phone_number ?? 'sin dato')}; nombre: ${String(numeroMeta?.verified_name ?? 'sin dato')}.`);

  // 2. Cifrado con el cofre v2, atado a flota y número (también en dry-run: prueba que la llave sirve).
  let tokenCifrado: string;
  try {
    tokenCifrado = (deps.cifrar ?? cifrar)({ token }, contextoCredencial(args.tenantId, args.phoneNumberId));
  } catch {
    return falla('El cofre no pudo cifrar el token (revisa LIKIDA_COFRE_LLAVE). No se guardó nada.');
  }
  if (!tokenCifrado.startsWith('v2.')) return falla('El cofre no devolvió formato v2. No se guardó nada.');
  secretos.push(tokenCifrado);

  const cab = { apikey: conexion.llave, Authorization: `Bearer ${conexion.llave}`, 'Content-Type': 'application/json' };
  const rest = (ruta: string) => `${conexion.url}/rest/v1/${ruta}`;

  // 3. La flota existe (lectura).
  try {
    const r = await deps.fetch(rest(`tenant?id=eq.${args.tenantId}&select=id&limit=1`), { method: 'GET', headers: cab });
    const filas = r.ok ? ((await r.json()) as unknown[]) : null;
    if (!filas || filas.length === 0) return falla('La flota (--tenant) no existe en la base. No se guardó nada.');
  } catch {
    return falla('No se pudo consultar la base. No se guardó nada.');
  }

  const fila = {
    tenant_id: args.tenantId, phone_number_id: args.phoneNumberId, waba_id: args.wabaId, numero_visible: args.numeroVisible,
    etiqueta: args.etiqueta, terminal_id: args.terminalId, proposito: args.proposito, principal: args.principal,
    token_cifrado: tokenCifrado, token_pistas: pistas(token), estado: 'pendiente',
  };

  if (args.dryRun) {
    const { token_cifrado: _omitido, ...visible } = fila;
    void _omitido;
    salida(`DRY-RUN: no se escribió nada. Se insertaría (token cifrado v2 omitido): ${JSON.stringify(visible)}`);
    if (args.activar) salida('DRY-RUN: con --activar se verificaría la suscripción del webhook y luego se activaría la línea.');
    return { codigo: 0, lineaId: null };
  }

  // 4. Alta PENDIENTE (el tenant sigue enviando por el número global hasta activar).
  let lineaId: string;
  try {
    const r = await deps.fetch(rest('tenant_whatsapp_linea'), { method: 'POST', headers: { ...cab, Prefer: 'return=representation' }, body: JSON.stringify(fila) });
    if (r.status === 409) return falla('Ese phone_number_id ya está registrado (o la flota ya tiene otra principal activa). No se guardó nada.');
    if (!r.ok) return falla(`La base rechazó el alta (HTTP ${r.status}). No se guardó nada.`);
    const filas = (await r.json()) as Array<{ id?: unknown }>;
    if (typeof filas[0]?.id !== 'string') return falla('La base no devolvió el id de la línea.');
    lineaId = filas[0].id;
  } catch {
    return falla('No se pudo escribir en la base. Revisa si la línea quedó registrada antes de repetir.');
  }
  salida(`Línea registrada PENDIENTE (id ${lineaId}, token …${token.slice(-4)}). El tenant sigue por el número global hasta activarla.`);
  if (!args.activar) return { codigo: 0, lineaId };

  // 5. Verificar el webhook: la app de Meta debe estar suscrita a la cuenta de WhatsApp Business de la línea (lectura).
  try {
    const r = await getMeta(deps.fetch, `${encodeURIComponent(args.wabaId as string)}/subscribed_apps`, token);
    const apps = Array.isArray(r.json?.data) ? (r.json?.data as unknown[]) : [];
    if (!r.ok || apps.length === 0) {
      return falla(`El webhook NO está verificado: la cuenta ${args.wabaId} no tiene la app suscrita (HTTP ${r.status}${codigoMeta(r)}). La línea queda PENDIENTE; suscribe la app y repite con la herramienta de activación.`, 2, lineaId);
    }
  } catch {
    return falla('No se pudo verificar el webhook con Meta. La línea queda PENDIENTE.', 2, lineaId);
  }

  // 6. Activar (+ principal atómica).
  try {
    const u = await deps.fetch(rest(`tenant_whatsapp_linea?id=eq.${lineaId}`), {
      method: 'PATCH', headers: { ...cab, Prefer: 'return=minimal' },
      body: JSON.stringify({ estado: 'activa', verificada_en: new Date().toISOString(), ultimo_error: null, principal: false }),
    });
    if (!u.ok) return falla(`No se pudo activar la línea (HTTP ${u.status}). Queda PENDIENTE.`, 2, lineaId);
    if (args.principal) {
      const p = await deps.fetch(rest('rpc/tenant_whatsapp_linea_hacer_principal'), { method: 'POST', headers: cab, body: JSON.stringify({ p_linea_id: lineaId }) });
      if (!p.ok || (await p.json()) !== true) return falla('La línea quedó ACTIVA pero no se pudo marcar como principal; hazlo desde la herramienta de principal.', 2, lineaId);
    }
  } catch {
    return falla('No se pudo activar la línea. Revisa su estado antes de repetir.', 2, lineaId);
  }
  salida(`Línea ACTIVA${args.principal ? ' y principal' : ''}: el tenant envía y recibe por ese número.`);
  return { codigo: 0, lineaId };
}

/** Huella corta (no reversible) para citar un valor en un reporte sin mostrarlo. */
export const huella = (v: string): string => createHash('sha256').update(v).digest('hex').slice(0, 8);
