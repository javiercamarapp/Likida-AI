// ═══════════════════════════════════════════════════════════════════════════
// AVISOS — EL MODELO ÚNICO (11-nov-2026, encargo del dueño: «Avisos 19 y no me sale nada en la pantalla»).
//
// Antes había TRES cuentas distintas: la campana del pie de /admin sumaba los conteos de las fuentes de escalación MÁS las alertas
// extra; la lista de /admin/notificaciones pintaba otras alertas (sin las extra) y descartaba con localStorage; y la campana del
// panel del cliente no llevaba cifra. Resultado: «19» arriba y una lista que no mostraba esos 19.
//
// Ahora hay UNA lista de avisos (`Aviso`), generada por las fuentes que ya existían (`generar-admin.ts`, `generar-flota.ts`), y UNA
// regla de lectura: el número del pie es EXACTAMENTE `contarNoLeidos(avisos, leidas)` y la pestaña «No leídas» pinta esos mismos
// avisos. Este archivo es la parte pura (sin red, sin base): se prueba sin mocks.
//
// Reglas que se conservan de la mecánica anterior (admin/notificaciones-leidas.ts):
//  · un aviso es un CÁLCULO en vivo; su `clave` lleva la huella de la condición (el conteo), así que si la condición cambia el aviso
//    vuelve como no leído: «3 huérfanos que ya vi» no son «5 huérfanos»;
//  · «leído» no es «resuelto»: lo que tiene plazo legal, un SLA vencido o una fuente ciega (`silenciable: false`) NO se puede marcar
//    como leído, se queda como no leído y sigue contando hasta que se resuelva;
//  · una lectura caída se dice (avisos «No se pudo leer…»), nunca se vuelve «0».
// ═══════════════════════════════════════════════════════════════════════════

export type Severidad = 'critica' | 'atencion' | 'info';
export const SEVERIDADES: readonly Severidad[] = ['critica', 'atencion', 'info'];

export type Canal = 'app' | 'correo' | 'whatsapp';
export const CANALES: readonly Canal[] = ['app', 'correo', 'whatsapp'];

/** Los dos paneles. `admin` = consola de Likida (superadmin); `flota` = panel del cliente (por tenant). */
export type Ambito = { tipo: 'admin' } | { tipo: 'flota'; tenantId: string };

/** La llave con la que la base separa un ámbito de otro (`aviso_*.ambito`): 'admin' o el uuid de la flota. */
export function claveAmbito(a: Ambito): string {
  return a.tipo === 'admin' ? 'admin' : a.tenantId;
}

export type CategoriaAdmin = 'escalaciones' | 'soporte' | 'sistema' | 'costos' | 'negocio';
export type CategoriaFlota = 'operacion' | 'dinero' | 'conexiones' | 'sistema_flota';
export type Categoria = CategoriaAdmin | CategoriaFlota;

/** Los tipos de aviso que cada panel puede configurar (filas de la matriz de preferencias y opciones del filtro por tipo). */
export const CATEGORIAS: Record<Ambito['tipo'], readonly Categoria[]> = {
  admin: ['escalaciones', 'soporte', 'sistema', 'costos', 'negocio'],
  flota: ['operacion', 'dinero', 'conexiones', 'sistema_flota'],
};

export interface Aviso {
  /** Identidad del aviso para el estado «leído»: `<fuente>|<huella de la condición>`. Cambia cuando cambia la condición. */
  clave: string;
  /** Origen: la fuente que lo generó (escalación, cron, resumen del negocio…). El panel lo rotula con `notif.fuente.<fuente>`. */
  fuente: string;
  categoria: Categoria;
  severidad: Severidad;
  titulo: string;
  /** Una muestra de lo que lo compone (los más urgentes), o `null`. */
  detalle: string | null;
  /** La pantalla donde SE RESUELVE. `null` = no hay pantalla a la cual llevar (se dice; no se inventa un enlace que rebote). */
  href: string | null;
  /** Desde cuándo espera (ISO) cuando la fuente lo sabe; `null` = condición medida ahora, sin hora de inicio conocida. */
  desde: string | null;
  /** `false` = no se puede marcar como leído (plazo legal, SLA vencido, fuente ciega, sistema caído). */
  silenciable: boolean;
}

export type Pestana = 'no_leidos' | 'leidos' | 'todos';

export interface Filtros {
  pestana: Pestana;
  categoria: Categoria | 'todas';
  severidad: Severidad | 'todas';
}

export const FILTROS_INICIALES: Filtros = { pestana: 'no_leidos', categoria: 'todas', severidad: 'todas' };

/** ¿Está leído? Solo cuenta lo silenciable: un aviso que «leída» no puede ocultar nunca está leído. */
export function estaLeido(a: Aviso, leidas: ReadonlySet<string>): boolean {
  return a.silenciable && leidas.has(a.clave);
}

/** EL número del pie (campana) y de la pestaña «No leídas». Una sola función: no hay segunda cuenta que pueda discrepar. */
export function contarNoLeidos(avisos: readonly Aviso[], leidas: ReadonlySet<string>): number {
  let n = 0;
  for (const a of avisos) if (!estaLeido(a, leidas)) n += 1;
  return n;
}

/** ¿Alguno de los no leídos es crítico? Enciende el tono urgente de la campana. */
export function hayCriticoNoLeido(avisos: readonly Aviso[], leidas: ReadonlySet<string>): boolean {
  return avisos.some((a) => a.severidad === 'critica' && !estaLeido(a, leidas));
}

const PESO: Record<Severidad, number> = { critica: 0, atencion: 1, info: 2 };

/** Crítico primero; a igual severidad, el que lleva más tiempo esperando (sin hora conocida, al final). */
export function ordenarAvisos(avisos: readonly Aviso[]): Aviso[] {
  const t = (a: Aviso) => (a.desde ? Date.parse(a.desde) : Number.POSITIVE_INFINITY);
  return [...avisos].sort((a, b) => PESO[a.severidad] - PESO[b.severidad] || (t(a) === t(b) ? 0 : t(a) < t(b) ? -1 : 1) || a.clave.localeCompare(b.clave));
}

/** Aplica la pestaña y los filtros por tipo y severidad. Los conteos de las pestañas salen de aquí (`contarPestanas`), no de otro lado. */
export function filtrarAvisos(avisos: readonly Aviso[], leidas: ReadonlySet<string>, f: Filtros): Aviso[] {
  return ordenarAvisos(avisos.filter((a) => {
    if (f.categoria !== 'todas' && a.categoria !== f.categoria) return false;
    if (f.severidad !== 'todas' && a.severidad !== f.severidad) return false;
    const leido = estaLeido(a, leidas);
    return f.pestana === 'todos' || (f.pestana === 'leidos' ? leido : !leido);
  }));
}

export interface ConteosPestanas { no_leidos: number; leidos: number; todos: number }

/** Los números de las tres pestañas, sobre el MISMO universo (sin los filtros: la pestaña dice cuántos hay, el filtro recorta lo que se ve). */
export function contarPestanas(avisos: readonly Aviso[], leidas: ReadonlySet<string>): ConteosPestanas {
  const no = contarNoLeidos(avisos, leidas);
  return { no_leidos: no, leidos: avisos.length - no, todos: avisos.length };
}

/** Las claves que «Marcar todo como leído» escribe: los no leídos que se pueden silenciar (de lo que se ve, si hay filtros). */
export function clavesParaMarcarTodo(visibles: readonly Aviso[], leidas: ReadonlySet<string>): string[] {
  return visibles.filter((a) => a.silenciable && !leidas.has(a.clave)).map((a) => a.clave);
}

// ── Preferencias (qué avisos recibir, por qué canal) ────────────────────────

export interface Preferencia { categoria: Categoria; canal: Canal; activo: boolean }

export function esCategoriaDe(ambito: Ambito['tipo'], valor: unknown): valor is Categoria {
  return typeof valor === 'string' && (CATEGORIAS[ambito] as readonly string[]).includes(valor);
}

export function esCanal(valor: unknown): valor is Canal {
  return typeof valor === 'string' && (CANALES as readonly string[]).includes(valor);
}

/** Sin fila = encendido (se avisa por omisión: lo contrario sería silenciar sin que nadie lo pidiera). */
export function estaActivo(prefs: readonly Preferencia[], categoria: Categoria, canal: Canal): boolean {
  const fila = prefs.find((p) => p.categoria === categoria && p.canal === canal);
  return fila ? fila.activo : true;
}

/** Las categorías que la persona apagó para el canal «en la app». */
export function categoriasApagadasEnApp(prefs: readonly Preferencia[]): Set<Categoria> {
  return new Set(prefs.filter((p) => p.canal === 'app' && !p.activo).map((p) => p.categoria));
}

/**
 * Qué avisos entran a la lista y a la cuenta. Apagar «en la app» un tipo oculta sus avisos SILENCIABLES; los que «leído» no puede ocultar
 * (plazo legal, SLA vencido, fuente ciega, sistema caído) se muestran siempre: una preferencia no puede dejar a la consola ciega.
 */
export function aplicarPreferencias(avisos: readonly Aviso[], apagadas: ReadonlySet<Categoria>): Aviso[] {
  return avisos.filter((a) => !a.silenciable || !apagadas.has(a.categoria));
}

// ── Horario de silencio (correo y WhatsApp) ─────────────────────────────────

export interface Silencio { activo: boolean; desde: string; hasta: string; permiteCriticos: boolean }

export const SILENCIO_POR_OMISION: Silencio = { activo: false, desde: '22:00', hasta: '07:00', permiteCriticos: true };
export const ZONA_SILENCIO = 'America/Mexico_City';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `HH:MM` válida de 24 h. */
export function esHoraValida(v: unknown): v is string {
  return typeof v === 'string' && HORA.test(v);
}

/** Valida un horario antes de guardarlo: horas con forma exacta y un rango que no sea vacío (desde ≠ hasta). */
export function validarSilencio(v: { activo?: unknown; desde?: unknown; hasta?: unknown; permiteCriticos?: unknown }): Silencio | null {
  if (typeof v.activo !== 'boolean' || typeof v.permiteCriticos !== 'boolean') return null;
  if (!esHoraValida(v.desde) || !esHoraValida(v.hasta) || v.desde === v.hasta) return null;
  return { activo: v.activo, desde: v.desde, hasta: v.hasta, permiteCriticos: v.permiteCriticos };
}

const aMinutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Los minutos desde medianoche en la zona del horario (hora de Ciudad de México, sin horario de verano desde 2022). */
export function minutosDelDia(ahoraMs: number, zona: string = ZONA_SILENCIO): number {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ahoraMs));
  const h = Number(partes.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(partes.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

/**
 * ¿Está dentro del horario de silencio? El rango puede cruzar la medianoche (22:00 → 07:00). Apagado = nunca. Para un aviso crítico,
 * `permiteCriticos` lo deja pasar aun dentro del horario.
 */
export function enSilencio(s: Silencio, ahoraMs: number, severidad?: Severidad): boolean {
  if (!s.activo) return false;
  if (severidad === 'critica' && s.permiteCriticos) return false;
  const ahora = minutosDelDia(ahoraMs);
  const d = aMinutos(s.desde);
  const h = aMinutos(s.hasta);
  return d < h ? ahora >= d && ahora < h : ahora >= d || ahora < h;
}
