// ═══════════════════════════════════════════════════════════════════════════
// LA ZONA DE VENDEDORES — el pipeline de ventas de LIKIDA, no de una flota.
//
// El censo de vacantes (~800 empresas transportistas que ya NOMBRAN el dolor
// de la liquidación) entra al producto como tabla `prospecto` (0105), y los
// amigos que venden entran como `app_user` rol `vendedor` (tenant_id null —
// rol de Likida, como superadmin). Este módulo es TODO el motor: el dominio
// del embudo, la validación de captura, las lecturas/escrituras y el primer
// agente de ventas (el asignador round-robin).
//
// ── LAS REGLAS QUE GOBIERNAN ESTE ARCHIVO ──────────────────────────────────
//
// 1. LA COMISIÓN ES UNA REGLA, NO UNA CIFRA. 50% del primer mes / 20%
//    recurrente está pactado y documentado (comment on table prospecto,
//    0105) — pero el dinero real se calcula sobre COBROS reales, y Likida
//    hoy no le cobra a nadie. Las pantallas enseñan la regla y dicen "$0
//    cobrados"; jamás una comisión estimada con cara de medición.
//
// 2. EL VENDEDOR SOLO TOCA LO SUYO, Y EL ANCLA VIENE DE LA SESIÓN. Las
//    escrituras aceptan `soloDeVendedor` y lo clavan en el WHERE
//    (`.eq('vendedor_id', ...)`): un POST con el id de un prospecto ajeno
//    toca cero filas, y cero filas se REPORTA (patrón `editarCliente`), no
//    se calla. El userId viene del servidor, jamás del formulario.
//
// 3. LO PURO VIVE APARTE DE LO QUE CONSULTA. Transiciones, validación,
//    reparto y conteos son funciones sin base — se prueban sin mock pesado —
//    y las de IO solo orquestan. Mismo corte que `clientes.ts`.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { conteo, traerTodo } from './pg';
import { acotada } from './presupuesto';
import { DatoInvalido } from './errores';
import { esUuidValido } from './intake/cfdi';
import { provisionarUsuario } from '@/lib/auth/provisionar';
import { validarInvitacionVendedor } from '@/lib/auth/invitar';
import { estaApagado } from './interruptores';
import { registrarCorrida } from './agentes/corridas';
import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// PARTE PURA — sin una sola consulta.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * LA REGLA DE COMISIÓN PACTADA (Javier, 14-ago-2026), documentada también en
 * el `comment on table prospecto` de la 0105 para que sobreviva a cualquier
 * refactor. Las pantallas citan ESTAS constantes vía `reglaComision()` — un
 * "50%" tecleado a mano en un JSX sería una segunda fuente de la regla.
 */
export const COMISION_PRIMER_MES = 0.5;
export const COMISION_RECURRENTE = 0.2;

/**
 * La regla en palabras de pantalla, construida DESDE las constantes: si un
 * día la comisión cambia, cambia en un solo lugar y todas las pantallas
 * dicen lo nuevo. La aclaración es parte de la regla, no un pie de página:
 * sin ella, "50%" invita a multiplicar contra un cobro que no existe.
 */
export function reglaComision(): { primerMes: string; recurrente: string; aclaracion: string } {
  return {
    primerMes: `${Math.round(COMISION_PRIMER_MES * 100)}% del primer mes del cliente cerrado`,
    recurrente: `${Math.round(COMISION_RECURRENTE * 100)}% recurrente de cada mes siguiente`,
    aclaracion: 'La comisión se calcula sobre cobros reales. Likida hoy no le cobra a nadie: '
      + 'hay $0 cobrados y por lo tanto $0 de comisión — todavía no hay cifra que enseñar.',
  };
}

/** El embudo, en el orden del tablero. `perdido` va al final: no es una
 *  etapa del avance, es la salida. El dominio es el de la 0105. */
export const ESTADOS_PROSPECTO = [
  { valor: 'nuevo', rotulo: 'Nuevo' },
  { valor: 'contactado', rotulo: 'Contactado' },
  { valor: 'demo', rotulo: 'Demo' },
  { valor: 'negociacion', rotulo: 'Negociación' },
  { valor: 'cerrado', rotulo: 'Cerrado' },
  { valor: 'perdido', rotulo: 'Perdido' },
] as const;

/** Canonical commercial funnel used by new integrations. Legacy labels above
 * remain readable so historical rows and existing screens do not silently
 * change meaning during migration. */
export const ESTADOS_FUNNEL = [
  { valor: 'nuevo', rotulo: 'Nuevo' },
  { valor: 'contactado', rotulo: 'Contactado' },
  { valor: 'appointment', rotulo: 'Cita agendada' },
  { valor: 'rescheduled', rotulo: 'Cita reprogramada' },
  { valor: 'cancelled', rotulo: 'Cita cancelada' },
  { valor: 'no-show', rotulo: 'No se presentó' },
  { valor: 'demo', rotulo: 'Demo' },
  { valor: 'proposal', rotulo: 'Propuesta' },
  { valor: 'pilot', rotulo: 'Piloto' },
  { valor: 'won', rotulo: 'Ganado' },
  { valor: 'lost', rotulo: 'Perdido' },
] as const;
export type EstadoFunnel = (typeof ESTADOS_FUNNEL)[number]['valor'];

export function esEstadoFunnel(v: string): v is EstadoFunnel {
  return ESTADOS_FUNNEL.some((e) => e.valor === v);
}

export const TRANSICIONES_FUNNEL: Record<EstadoFunnel, readonly EstadoFunnel[]> = {
  nuevo: ['contactado', 'lost'],
  contactado: ['appointment', 'lost'],
  appointment: ['rescheduled', 'cancelled', 'demo', 'lost'],
  rescheduled: ['appointment', 'cancelled', 'demo', 'lost'],
  cancelled: ['contactado', 'appointment', 'lost'],
  'no-show': ['contactado', 'appointment', 'lost'],
  demo: ['proposal', 'pilot', 'no-show', 'lost'],
  proposal: ['pilot', 'won', 'lost'],
  pilot: ['won', 'lost'],
  won: [],
  lost: ['contactado'],
};

export function puedeTransicionarFunnel(de: string, a: string): boolean {
  return esEstadoFunnel(de) && esEstadoFunnel(a) && TRANSICIONES_FUNNEL[de].includes(a);
}

export type EstadoProspecto = (typeof ESTADOS_PROSPECTO)[number]['valor'];

export function esEstadoProspecto(v: string): v is EstadoProspecto {
  return ESTADOS_PROSPECTO.some((e) => e.valor === v);
}

export function rotuloEstado(v: string): string {
  return ESTADOS_PROSPECTO.find((e) => e.valor === v)?.rotulo ?? v;
}

/** Los estados que cuentan como cartera VIVA de un vendedor — lo que carga
 *  su día. Cerrado y perdido ya no piden trabajo. */
export const ESTADOS_VIVOS: readonly EstadoProspecto[] = ['nuevo', 'contactado', 'demo', 'negociacion'];

/**
 * Qué transiciones admite el embudo. Un paso atrás existe para CORREGIR
 * (una demo que se agendó de más se regresa a contactado); `perdido` se
 * alcanza desde cualquier etapa viva y se REACTIVA solo a contactado (un
 * perdido que vuelve ya no es "nuevo": ya se le habló). `cerrado` es
 * TERMINAL a propósito: estampa `cerrado_en` y de él cuelga la liga con la
 * flota real y la comisión — deshacerlo no es un botón del tablero, es una
 * decisión de negocio que hoy no existe.
 */
export const TRANSICIONES_PROSPECTO: Record<EstadoProspecto, readonly EstadoProspecto[]> = {
  nuevo: ['contactado', 'perdido'],
  contactado: ['nuevo', 'demo', 'perdido'],
  demo: ['contactado', 'negociacion', 'perdido'],
  negociacion: ['demo', 'cerrado', 'perdido'],
  cerrado: [],
  perdido: ['contactado'],
};

export function puedeTransicionar(de: string, a: string): boolean {
  if (!esEstadoProspecto(de) || !esEstadoProspecto(a)) return false;
  return TRANSICIONES_PROSPECTO[de].includes(a);
}

// ── Validación de captura ──────────────────────────────────────────────────

/** Lo que llega del formulario: puros strings, porque un `<input>` no da otra cosa. */
export interface ProspectoCrudo {
  empresa: string;
  contactoNombre: string;
  telefono: string;
  correo: string;
  ciudad: string;
  vacante: string;
  notas: string;
  /** `''` = sin asignar (queda para el asignador). */
  vendedorId: string;
}

export interface ProspectoValido {
  empresa: string;
  contactoNombre: string | null;
  telefono: string | null;
  correo: string | null;
  ciudad: string | null;
  vacante: string | null;
  notas: string | null;
  vendedorId: string | null;
}

/** `''` → `null` — un string vacío guardado es un dato que parece capturado.
 *  Mismo helper que `clientes.ts`; se repite porque es una línea, no una regla. */
function opcional(crudo: string, campo: string, max: number): string | null {
  const t = crudo.trim();
  if (t === '') return null;
  if (t.length > max) throw new DatoInvalido(`${campo} no puede pasar de ${max} caracteres.`);
  return t;
}

/** La misma forma mínima que `validarCliente` — lineal, sin ReDoS. */
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarProspecto(p: ProspectoCrudo): ProspectoValido {
  // Lo ÚNICO obligatorio es la empresa: el censo trae filas con puros nombre
  // y vacante, y exigir más dejaría fuera justo el material de trabajo.
  const empresa = p.empresa.trim();
  if (empresa === '') throw new DatoInvalido('Falta la empresa: es lo único obligatorio de un prospecto.');
  if (empresa.length > 160) throw new DatoInvalido('El nombre de la empresa no puede pasar de 160 caracteres.');

  const correo = opcional(p.correo, 'El correo', 160);
  if (correo !== null && !CORREO_RE.test(correo)) {
    throw new DatoInvalido(`"${correo}" no se ve como un correo. Escríbelo completo o déjalo vacío.`);
  }

  // Contacto de VENTAS, no identidad de WhatsApp: se guarda como se tecleó
  // (extensiones incluidas), solo se comprueba que alcance para marcar.
  const telefono = opcional(p.telefono, 'El teléfono', 40);
  if (telefono !== null) {
    const digitos = telefono.replace(/\D/g, '');
    if (digitos.length < 10 || digitos.length > 15) {
      throw new DatoInvalido('El teléfono necesita entre 10 y 15 dígitos (con lada). Déjalo vacío si no lo tienes.');
    }
  }

  let vendedorId: string | null = null;
  if (p.vendedorId.trim() !== '') {
    vendedorId = p.vendedorId.trim();
    // Basura aquí llegaría a Postgres como `22P02 invalid input syntax for
    // type uuid`, que en pantalla no le dice nada a nadie.
    if (!esUuidValido(vendedorId)) throw new DatoInvalido('El vendedor no es válido. Vuelve a elegirlo de la lista.');
  }

  return {
    empresa,
    contactoNombre: opcional(p.contactoNombre, 'El contacto', 120),
    telefono,
    correo,
    ciudad: opcional(p.ciudad, 'La ciudad', 120),
    vacante: opcional(p.vacante, 'La vacante', 160),
    notas: opcional(p.notas, 'Las notas', 2000),
    vendedorId,
  };
}

// ── El reparto round-robin, puro ───────────────────────────────────────────

/**
 * Reparte pendientes entre vendedores equilibrando por carga VIVA actual:
 * cada prospecto va al vendedor con menos carga en ese momento (la carga
 * inicial más lo ya repartido en esta vuelta). DETERMINISTA: a igual carga
 * gana el id menor — la misma entrada produce el mismo plan siempre, que es
 * lo que permite probarlo y explicarlo.
 *
 * Devuelve el plan, no lo ejecuta: la escritura (con sus carreras y sus
 * errores por valor) es de `asignarPendientes`; esto se prueba sin base.
 */
export function repartir(
  pendientes: readonly string[],
  vendedores: ReadonlyArray<{ id: string; vivos: number }>,
): Map<string, string[]> {
  const plan = new Map<string, string[]>();
  if (vendedores.length === 0) return plan;

  const cargas = vendedores.map((v) => ({ id: v.id, carga: v.vivos }));
  for (const p of pendientes) {
    let mejor = cargas[0];
    for (const c of cargas) {
      if (c.carga < mejor.carga || (c.carga === mejor.carga && c.id < mejor.id)) mejor = c;
    }
    mejor.carga++;
    const lista = plan.get(mejor.id);
    if (lista) lista.push(p);
    else plan.set(mejor.id, [p]);
  }
  return plan;
}

// ── Conteos por vendedor, puro ─────────────────────────────────────────────

export function conteosVacios(): Record<EstadoProspecto, number> {
  return { nuevo: 0, contactado: 0, demo: 0, negociacion: 0, cerrado: 0, perdido: 0 };
}

/** Agrupa (vendedorId → conteos por estado). La llave `null` es el pool sin
 *  asignar. Un estado fuera del dominio no se inventa columna: se ignora y
 *  se deja al CHECK de la base impedir que exista. */
export function agruparConteos(
  filas: ReadonlyArray<{ vendedorId: string | null; estado: string }>,
): Map<string | null, Record<EstadoProspecto, number>> {
  const m = new Map<string | null, Record<EstadoProspecto, number>>();
  for (const f of filas) {
    if (!esEstadoProspecto(f.estado)) continue;
    const c = m.get(f.vendedorId) ?? conteosVacios();
    c[f.estado]++;
    m.set(f.vendedorId, c);
  }
  return m;
}

/** Búsqueda de tablero sin pelearse con acentos ni mayúsculas — la misma
 *  normalización que `normalizarPlaza` (clientes.ts). */
function normalizarBusqueda(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function filtrarProspectosTexto<T extends { empresa: string; vacante: string | null; ciudad: string | null }>(
  filas: readonly T[],
  texto: string | undefined,
): T[] {
  const q = texto ? normalizarBusqueda(texto) : '';
  if (q === '') return [...filas];
  return filas.filter((f) =>
    normalizarBusqueda(f.empresa).includes(q)
    || (f.vacante !== null && normalizarBusqueda(f.vacante).includes(q))
    || (f.ciudad !== null && normalizarBusqueda(f.ciudad).includes(q)));
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTE CON BASE DE DATOS.
// ═══════════════════════════════════════════════════════════════════════════

export interface ProspectoRow {
  id: string;
  empresa: string;
  contactoNombre: string | null;
  telefono: string | null;
  correo: string | null;
  ciudad: string | null;
  vacante: string | null;
  fuente: string;
  estado: EstadoProspecto;
  vendedorId: string | null;
  /** Solo en cerrados: la flota real que nació del trato (0105). */
  tenantId: string | null;
  notas: string | null;
  cerradoEn: string | null;
  createdAt: string;
}

export interface FiltroProspectos {
  /** `null` = solo los SIN asignar; ausente = todos. */
  vendedorId?: string | null;
  estado?: EstadoProspecto;
}

export interface PaginaProspectos {
  q?: string;
  pagina?: number;
  porPagina?: number;
}

/** Small server-side search window for command palettes and admin tables.
 * The full pipeline reader remains available for the kanban, while callers
 * that need a search never download the entire census. */
export async function buscarProspectos(opciones: PaginaProspectos = {}): Promise<{
  filas: ProspectoRow[]; total: number | null; pagina: number; porPagina: number;
}> {
  const pagina = Math.max(1, Math.floor(opciones.pagina ?? 1));
  const porPagina = Math.min(100, Math.max(1, Math.floor(opciones.porPagina ?? 25)));
  const qTexto = opciones.q?.trim().slice(0, 120) ?? '';
  let query = supabaseAdmin().from('prospecto')
    .select('id, empresa, contacto_nombre, telefono, correo, ciudad, vacante, fuente, estado, vendedor_id, tenant_id, notas, cerrado_en, created_at', { count: 'exact' })
    .is('duplicado_de', null)
    .order('created_at', { ascending: false }).order('id')
    .range((pagina - 1) * porPagina, pagina * porPagina - 1);
  if (qTexto) query = query.ilike('empresa', `%${qTexto.replace(/[%_]/g, '')}%`);
  const { data, error, count } = await acotada(query, 'buscarProspectos');
  if (error) throw new Error(`buscarProspectos: ${error.message}`);
  const filas = ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    id: String(f.id), empresa: String(f.empresa), contactoNombre: (f.contacto_nombre as string) ?? null,
    telefono: (f.telefono as string) ?? null, correo: (f.correo as string) ?? null,
    ciudad: (f.ciudad as string) ?? null, vacante: (f.vacante as string) ?? null,
    fuente: String(f.fuente ?? 'censo'), estado: f.estado as EstadoProspecto,
    vendedorId: (f.vendedor_id as string) ?? null, tenantId: (f.tenant_id as string) ?? null,
    notas: (f.notas as string) ?? null, cerradoEn: (f.cerrado_en as string) ?? null,
    createdAt: String(f.created_at),
  }));
  return { filas, total: typeof count === 'number' ? count : null, pagina, porPagina };
}

/**
 * SIN CATCH POR DENTRO, como `getPanelClientes`: una base caída tiene que
 * subir como error — "no se pudo leer el pipeline" — y no como un tablero
 * vacío que afirma que no hay prospectos.
 */
export async function listarProspectos(filtro: FiltroProspectos = {}): Promise<ProspectoRow[]> {
  const admin = supabaseAdmin();
  const filas = await traerTodo<Record<string, unknown>>((d, h) => {
    let q = admin.from('prospecto')
      .select('id, empresa, contacto_nombre, telefono, correo, ciudad, vacante, fuente, estado, vendedor_id, tenant_id, notas, cerrado_en, created_at', conteo(d))
      .is('duplicado_de', null);
    // `.is` para null y `.eq` para un id: `.eq('vendedor_id', null)` NO
    // matchea filas NULL en Postgres — devolvería siempre vacío, en silencio.
    if (filtro.vendedorId === null) q = q.is('vendedor_id', null);
    else if (filtro.vendedorId !== undefined) q = q.eq('vendedor_id', filtro.vendedorId);
    if (filtro.estado !== undefined) q = q.eq('estado', filtro.estado);
    return q.order('created_at', { ascending: false }).order('id').range(d, h);
  }, 'listarProspectos');

  return filas.map((f) => ({
    id: String(f.id),
    empresa: String(f.empresa),
    contactoNombre: (f.contacto_nombre as string) ?? null,
    telefono: (f.telefono as string) ?? null,
    correo: (f.correo as string) ?? null,
    ciudad: (f.ciudad as string) ?? null,
    vacante: (f.vacante as string) ?? null,
    fuente: String(f.fuente ?? 'censo'),
    // FRONTEND-19C2-4: este cast YA NO es cierto sin más. `prospecto_estado_dominio`
    // (0105) garantizaba el dominio cuando `EstadoProspecto` tenía las mismas 6
    // llaves que el CHECK — pero la 0181 amplió el CHECK con los 11 estados del
    // embudo de Cal.com sin ampliar este tipo. La base puede devolver un valor
    // que NO está en `EstadoProspecto`; quien consuma `estado` debe validar con
    // `esEstadoProspecto` antes de indexar un `Record<EstadoProspecto, ...>`
    // con él (ver `agruparConteos`) — no asumir el cast a ciegas.
    estado: f.estado as EstadoProspecto,
    vendedorId: (f.vendedor_id as string) ?? null,
    tenantId: (f.tenant_id as string) ?? null,
    notas: (f.notas as string) ?? null,
    cerradoEn: (f.cerrado_en as string) ?? null,
    createdAt: String(f.created_at),
  }));
}

export interface VendedorRow {
  id: string;
  nombre: string | null;
  email: string;
  conteos: Record<EstadoProspecto, number>;
  /** Total de prospectos asignados (todas las etapas). */
  asignados: number;
  /** Los que cargan su día: ni cerrados ni perdidos. */
  vivos: number;
  cerrados: number;
  /**
   * cerrados / asignados — `null` cuando asignados es 0: sin cartera no hay
   * tasa, y un 0% pintado se leería como "lo intentó y no cerró nada".
   */
  tasaConversion: number | null;
}

/** El equipo de ventas con su cartera contada por estado. LANZA ante un
 *  error de lectura: "no hay vendedores" con la base caída sería mentira. */
export async function listarVendedores(): Promise<VendedorRow[]> {
  const admin = supabaseAdmin();
  const [cuentas, prospectos] = await Promise.all([
    traerTodo<Record<string, unknown>>(
      (d, h) => admin.from('app_user').select('id, nombre, email', conteo(d))
        .eq('rol', 'vendedor').order('id').range(d, h),
      'listarVendedores.cuentas',
    ),
    traerTodo<Record<string, unknown>>(
      (d, h) => admin.from('prospecto').select('id, vendedor_id, estado', conteo(d))
        .is('duplicado_de', null).order('id').range(d, h),
      'listarVendedores.prospectos',
    ),
  ]);

  const porVendedor = agruparConteos(prospectos.map((p) => ({
    vendedorId: (p.vendedor_id as string) ?? null,
    estado: String(p.estado),
  })));

  return cuentas.map((c) => {
    const conteos = porVendedor.get(String(c.id)) ?? conteosVacios();
    const asignados = (Object.values(conteos) as number[]).reduce((s, n) => s + n, 0);
    const vivos = ESTADOS_VIVOS.reduce((s, e) => s + conteos[e], 0);
    return {
      id: String(c.id),
      nombre: (c.nombre as string) ?? null,
      email: String(c.email),
      conteos,
      asignados,
      vivos,
      cerrados: conteos.cerrado,
      tasaConversion: asignados > 0 ? conteos.cerrado / asignados : null,
    };
  }).sort((a, b) => (a.nombre ?? a.email).localeCompare(b.nombre ?? b.email, 'es'));
}

/** Que el uuid sea de una cuenta rol `vendedor` — fail closed, como
 *  `clientePropio`: sin esto, un POST directo colgaría la cartera de
 *  cualquier app_user (un contador de una flota, p.ej.). */
async function esVendedor(vendedorId: string): Promise<boolean> {
  const filas = await traerTodo<{ id: unknown }>(
    (d, h) => supabaseAdmin().from('app_user').select('id', conteo(d))
      .eq('id', vendedorId).eq('rol', 'vendedor').order('id').range(d, h),
    'esVendedor',
  );
  return filas.length > 0;
}

export async function crearProspecto(
  p: ProspectoValido,
  /** El censo se importa con 'censo'; el alta del panel es 'manual'. */
  fuente: 'manual' | 'censo' = 'manual',
): Promise<string> {
  if (p.vendedorId !== null && !(await esVendedor(p.vendedorId))) {
    throw new DatoInvalido('Esa cuenta no es un vendedor. Vuelve a elegirlo de la lista.');
  }

  const { data, error } = await acotada(supabaseAdmin().from('prospecto').insert({
    empresa: p.empresa,
    contacto_nombre: p.contactoNombre,
    telefono: p.telefono,
    correo: p.correo,
    ciudad: p.ciudad,
    vacante: p.vacante,
    notas: p.notas,
    vendedor_id: p.vendedorId,
    fuente,
  }).select('id').single(), 'crearProspecto');

  if (error) throw new Error(`crearProspecto: ${error.message}`);
  const id = (data as { id?: unknown } | null)?.id;
  if (!id) throw new Error('crearProspecto: el insert no devolvió id');
  return id as string;
}

/**
 * Alta de un vendedor. REUSA el alta real del repo — `provisionarUsuario`
 * (Auth + app_user) con rol `vendedor` y tenant null — y la validación pura
 * de `invitar.ts`. Igual que el flujo D6: NO se manda correo de invitación
 * (esa plantilla existe y nadie la emite todavía) — el vendedor entra
 * tecleando su correo en /login y le llega el magic link de Supabase; la
 * pantalla lo dice tal cual en vez de prometer un correo que no sale.
 */
export async function invitarVendedor(correo: string, nombre: string): Promise<{ userId: string; email: string }> {
  const v = validarInvitacionVendedor({ email: correo, nombre });
  const { userId } = await provisionarUsuario(null, v.email, v.nombre, 'vendedor');
  return { userId, email: v.email };
}

/** Asignar o reasignar (`null` = devolver al pool). Solo el admin lo llama:
 *  el panel del vendedor no ofrece asignar, y su server action tampoco. */
export async function asignarProspecto(prospectoId: string, vendedorId: string | null): Promise<void> {
  if (!esUuidValido(prospectoId)) throw new DatoInvalido('No se reconoce ese prospecto. Recarga la pantalla.');
  if (vendedorId !== null) {
    if (!esUuidValido(vendedorId)) throw new DatoInvalido('No se reconoce ese vendedor. Recarga la pantalla.');
    if (!(await esVendedor(vendedorId))) {
      throw new DatoInvalido('Esa cuenta no es un vendedor. Vuelve a elegirlo de la lista.');
    }
  }

  const { data, error } = await acotada(supabaseAdmin().from('prospecto')
    .update({ vendedor_id: vendedorId, updated_at: new Date().toISOString() })
    .eq('id', prospectoId).is('duplicado_de', null).select('id'), 'asignarProspecto');
  if (error) throw new Error(`asignarProspecto: ${error.message}`);
  // Un UPDATE de cero filas no es éxito (patrón `editarCliente`).
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('No se encontró ese prospecto. Puede que alguien lo haya borrado — recarga la pantalla.');
  }
}

/**
 * Mover un prospecto en el embudo — SOLO transiciones del dominio.
 *
 * Al pasar a `cerrado` estampa `cerrado_en` (el constraint
 * `prospecto_cerrado_coherente` lo exige en los dos sentidos). El UPDATE va
 * anclado al estado LEÍDO: si otro agente lo movió entre la lectura y la
 * escritura, tocamos cero filas y se dice, en vez de pisar su movimiento.
 *
 * `soloDeVendedor` es el ancla del panel del vendedor: viene del userId de
 * SESIÓN (jamás del formulario) y se clava en lectura Y escritura — un
 * prospecto ajeno simplemente "no existe" para esa sesión.
 */
export async function cambiarEstadoProspecto(
  prospectoId: string,
  estadoNuevo: string,
  opts: { notas?: string; soloDeVendedor?: string } = {},
): Promise<void> {
  if (!esUuidValido(prospectoId)) throw new DatoInvalido('No se reconoce ese prospecto. Recarga la pantalla.');
  if (!esEstadoProspecto(estadoNuevo)) throw new DatoInvalido('Ese estado no existe en el embudo.');
  const notas = opts.notas === undefined ? undefined : opcional(opts.notas, 'Las notas', 2000);

  let lectura = supabaseAdmin().from('prospecto').select('id, estado').eq('id', prospectoId).is('duplicado_de', null);
  if (opts.soloDeVendedor) lectura = lectura.eq('vendedor_id', opts.soloDeVendedor);
  const { data: fila, error: errLee } = await acotada(lectura.maybeSingle(), 'cambiarEstadoProspecto.lee');
  if (errLee) throw new Error(`cambiarEstadoProspecto: ${errLee.message}`);
  if (!fila) throw new DatoInvalido('Ese prospecto no existe o no es tuyo.');

  const actual = String((fila as Record<string, unknown>).estado);
  if (!puedeTransicionar(actual, estadoNuevo)) {
    throw new DatoInvalido(
      `De "${rotuloEstado(actual)}" no se puede pasar a "${rotuloEstado(estadoNuevo)}". `
      + (actual === 'cerrado'
        ? 'Un trato cerrado no se reabre desde el tablero: ya tiene fecha de cierre y de él cuelga la comisión.'
        : 'Mueve el prospecto por las etapas del embudo.'),
    );
  }

  const cambios: Record<string, unknown> = {
    estado: estadoNuevo,
    // `null` explícito en todo destino no-cerrado: cinturón y tirantes con el
    // constraint — nunca puede quedar una fecha de cierre en un no-cerrado.
    cerrado_en: estadoNuevo === 'cerrado' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  if (notas !== undefined) cambios.notas = notas;

  let up = supabaseAdmin().from('prospecto').update(cambios)
    .eq('id', prospectoId).is('duplicado_de', null).eq('estado', actual);
  if (opts.soloDeVendedor) up = up.eq('vendedor_id', opts.soloDeVendedor);
  const { data, error } = await acotada(up.select('id'), 'cambiarEstadoProspecto');
  if (error) throw new Error(`cambiarEstadoProspecto: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('El prospecto cambió mientras lo movías. Recarga la pantalla y vuelve a intentarlo.');
  }
}

/** Guardar la nota de trabajo de un prospecto, con la misma ancla de sesión
 *  que `cambiarEstadoProspecto`. `''` borra la nota (null), no guarda vacío. */
export async function actualizarNotasProspecto(
  prospectoId: string,
  notas: string,
  opts: { soloDeVendedor?: string } = {},
): Promise<void> {
  if (!esUuidValido(prospectoId)) throw new DatoInvalido('No se reconoce ese prospecto. Recarga la pantalla.');
  const valor = opcional(notas, 'Las notas', 2000);

  let up = supabaseAdmin().from('prospecto')
    .update({ notas: valor, updated_at: new Date().toISOString() })
    .eq('id', prospectoId).is('duplicado_de', null);
  if (opts.soloDeVendedor) up = up.eq('vendedor_id', opts.soloDeVendedor);
  const { data, error } = await acotada(up.select('id'), 'actualizarNotasProspecto');
  if (error) throw new Error(`actualizarNotasProspecto: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Ese prospecto no existe o no es tuyo.');
  }
}

// ── El agente asignador ────────────────────────────────────────────────────

export interface ResultadoReparto {
  /** Cuántos quedaron asignados DE VERDAD (filas confirmadas por la base). */
  repartidos: number;
  /** Cuántos pendientes había al arrancar. */
  pendientes: number;
  porVendedor: Array<{ vendedorId: string; nombre: string; n: number }>;
  sinVendedores: boolean;
  /** `agente:ventas` (0110) está apagado: no se leyó ni repartió nada, y la
   *  consola lo dice con esas palabras — no como "no había pendientes". */
  apagado?: boolean;
}

/**
 * EL PRIMER AGENTE DE VENTAS: reparte los prospectos sin vendedor y en
 * estado `nuevo` entre los vendedores, equilibrando por carga viva
 * (`repartir`, arriba, que es puro y determinista).
 *
 * Cada UPDATE va anclado a `vendedor_id is null and estado = 'nuevo'`: si
 * alguien asignó o movió un prospecto entre el plan y la escritura, esa fila
 * se queda como está y el conteo lo refleja — repartir jamás pisa una
 * asignación hecha a mano.
 *
 * La corrida se anota en `agente_corrida` como agente `ventas` con tenant
 * null (0105) vía `registrarCorrida`, que JAMÁS lanza: perder la anotación
 * es mil veces mejor que deshacer un reparto ya hecho.
 */
export async function asignarPendientes(): Promise<ResultadoReparto> {
  // ── EL KILL SWITCH (0110), ANTES DE LEER NADA ────────────────────────────
  // Fase 1 del blueprint (15-ago-2026): `agente:ventas` existía en el
  // catálogo y ningún call site lo preguntaba. Un reparto saltado NO anota
  // corrida — no corrió — y no es un fallo: es la palanca haciendo su
  // trabajo. Fail-closed: si el interruptor no se puede LEER, tampoco se
  // reparte (estaApagado devuelve apagado con grito — ver interruptores.ts).
  if (await estaApagado('agente:ventas')) {
    return { repartidos: 0, pendientes: 0, porVendedor: [], sinVendedores: false, apagado: true };
  }
  const inicio = new Date();
  const vendedores = await listarVendedores();
  const pendientesFilas = await traerTodo<Record<string, unknown>>(
    (d, h) => supabaseAdmin().from('prospecto').select('id', conteo(d))
      .is('vendedor_id', null).is('duplicado_de', null).eq('estado', 'nuevo')
      // Los más viejos primero: el orden de llegada es el orden de reparto, y
      // con el desempate por id el plan es reproducible.
      .order('created_at', { ascending: true }).order('id').range(d, h),
    'asignarPendientes.pendientes',
  );
  const pendientes = pendientesFilas.map((f) => String(f.id));

  if (pendientes.length === 0) {
    await registrarCorrida(null, 'ventas', {
      inicio, fin: new Date(), estado: 'ok', disparo: 'manual',
      tareasHechas: 0, tareasTotal: 0, resumen: { repartidos: 0 },
    });
    return { repartidos: 0, pendientes: 0, porVendedor: [], sinVendedores: vendedores.length === 0 };
  }

  if (vendedores.length === 0) {
    await registrarCorrida(null, 'ventas', {
      inicio, fin: new Date(), estado: 'fallo', disparo: 'manual',
      tareasHechas: 0, tareasTotal: pendientes.length,
      error: 'No hay vendedores a quienes repartir. Invita al primero y vuelve a correr.',
    });
    return { repartidos: 0, pendientes: pendientes.length, porVendedor: [], sinVendedores: true };
  }

  const plan = repartir(pendientes, vendedores.map((v) => ({ id: v.id, vivos: v.vivos })));
  const nombreDe = new Map(vendedores.map((v) => [v.id, v.nombre ?? v.email]));

  let repartidos = 0;
  let huboError = false;
  const porVendedor: ResultadoReparto['porVendedor'] = [];
  const resumenPorVendedor: Record<string, number> = {};
  for (const [vendedorId, ids] of plan) {
    const { data, error } = await acotada(supabaseAdmin().from('prospecto')
      .update({ vendedor_id: vendedorId, updated_at: new Date().toISOString() })
      .in('id', ids).is('vendedor_id', null).eq('estado', 'nuevo')
      .select('id'), 'asignarPendientes.asigna');
    if (error) {
      // No se aborta a media vuelta: lo ya asignado ES un avance real y
      // deshacerlo (o dejar de contar al resto) sería peor. Se anota y la
      // corrida sale `parcial`/`fallo` con el motivo redactado.
      huboError = true;
      logger.error('vendedores.reparto_fallo', { vendedorId, err: error.message });
      continue;
    }
    const n = Array.isArray(data) ? data.length : 0;
    repartidos += n;
    resumenPorVendedor[vendedorId] = n;
    if (n > 0) porVendedor.push({ vendedorId, nombre: nombreDe.get(vendedorId) ?? vendedorId, n });
  }
  porVendedor.sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre, 'es'));

  const estado = repartidos === pendientes.length ? 'ok' : repartidos > 0 ? 'parcial' : 'fallo';
  await registrarCorrida(null, 'ventas', {
    inicio, fin: new Date(), estado, disparo: 'manual',
    tareasHechas: repartidos, tareasTotal: pendientes.length,
    // Ids, no nombres: el resumen de la bitácora viaja sin datos personales
    // (regla de la 0102); la pantalla resuelve nombres al pintar.
    resumen: { repartidos, porVendedor: resumenPorVendedor },
    error: estado === 'ok' ? undefined
      : huboError ? 'Alguna escritura no se completó. Vuelve a repartir: lo ya asignado no se pierde.'
        : 'Algunos prospectos cambiaron de mano mientras se repartía — no se pisó ninguna asignación manual.',
  });

  return { repartidos, pendientes: pendientes.length, porVendedor, sinVendedores: false };
}
