import { supabaseAdmin } from '@/lib/supabase/admin';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { acotada } from '@/lib/likida/presupuesto';
import { DatoInvalido } from '@/lib/likida/errores';
import { esUuidValido } from '@/lib/likida/intake/cfdi';

// ═══════════════════════════════════════════════════════════════════════════
// LAS SESIONES MCP DE UNA FLOTA — ver quién tiene conectado qué, y cortarlo.
//
// La 0260 montó el servidor MCP con OAuth y la 0265 dejó
// `revocar_mcp_oauth_usuario(tenant, usuario)` escrita y con grant a
// service_role… y SIN UN SOLO LLAMADOR en `src/` (hallazgo H3 de la auditoría
// de dashboards, 29-ago-2026). El comentario de esa migración lo dice con
// todas sus letras: «queda lista para cablearse el día que ese flujo exista».
// Este archivo es ese cable.
//
// El hueco no era teórico: un usuario que autorizó Claude o ChatGPT en
// /mcp/autorizar quedaba con un acceso de LECTURA a los datos de su área
// —cuadres, facturación, clientes— renovable cada 60 días, y no había una
// sola pantalla en todo el producto que lo enseñara ni que lo cortara. La
// única salida era SQL a mano.
//
// ── EL MOLDE ES `llave-api-escritura.ts`, Y NO ES CASUAL ───────────────────
// Un token MCP y una llave `lk_live_…` son la misma clase de cosa: una
// credencial que lee los datos de la flota SIN sesión de navegador. Aquella
// pantalla (A6, auditoría 4) ya resolvió el problema entero —listar, decir
// cuándo se usó por última vez, revocar sin deshacer— y repetir su forma es
// lo que hace que las dos se entiendan sin volver a aprenderlas. De ahí
// vienen también sus dos reglas duras, que aquí se sostienen igual:
//   · el `tenantId` viene SIEMPRE por argumento desde la sesión del servidor,
//     nunca del formulario;
//   · un error de lectura LANZA en vez de devolver una lista vacía — «no
//     tienes nada conectado» pintado sobre una base caída es exactamente la
//     mentira que haría que nadie revocara nada.
//
// ── QUÉ ES UNA "SESIÓN" AQUÍ: LA FAMILIA, NO EL TOKEN ──────────────────────
// Cada consentimiento nace con una `familia` (0260) y cada rotación del
// refresco emite un par nuevo DENTRO de esa familia. Enseñar tokens sueltos
// haría que un cliente conectado hace dos meses apareciera como veinte
// renglones idénticos. Se agrupa por familia: una familia viva = un cliente
// MCP conectado, que es lo que la persona reconoce y lo que quiere cortar.
//
// ── LA REVOCACIÓN ES POR USUARIO, Y LA PANTALLA LO DICE ────────────────────
// `revocar_mcp_oauth_usuario` tumba TODOS los tokens vivos de un usuario en
// una flota, no una familia. No se inventa aquí una revocación por familia:
// la función de la 0265 es la que existe, la que tiene grant y la que la
// migración documentó — y para el escenario real del hallazgo (se perdió la
// laptop, se fue el empleado) cortar todo de un tiro es justamente lo que se
// quiere. El botón se rotula diciendo eso, no otra cosa.
// ═══════════════════════════════════════════════════════════════════════════

/** Un cliente MCP conectado: UNA familia viva (0260), no un token suelto. */
export interface ClienteMcpConectado {
  /** El id de la familia — la identidad estable de la conexión. */
  familia: string;
  /**
   * El nombre que declaró quien registró el cliente por DCR («Claude»,
   * «ChatGPT»). Es INFORMATIVO y la pantalla lo advierte, igual que la
   * pantalla de consentimiento: lo eligió quien se registró, no Likida.
   */
  cliente: string | null;
  /** El más antiguo de los tokens VIVOS de la familia. */
  otorgadoEn: string;
  /** `null` = nunca se ha usado. La pantalla lo dice así, no con un guion. */
  ultimoUsoEn: string | null;
  /** Hasta cuándo alcanza lo ya emitido si nadie vuelve a refrescar. */
  expiraEn: string;
}

/** Un usuario de la flota con al menos un cliente MCP conectado. */
export interface SesionMcpUsuario {
  userId: string;
  nombre: string | null;
  email: string | null;
  /**
   * El rol CONGELADO en el token, que es el que decide qué puede leer el
   * cliente MCP — no el que tenga hoy la fila de `app_user`. Desde la 0265 un
   * desajuste entre los dos hace que el siguiente refresco se niegue solo,
   * pero el acceso ya emitido sigue vivo hasta que expira o hasta aquí.
   */
  rol: string;
  clientes: ClienteMcpConectado[];
  /** El uso más reciente de cualquiera de sus clientes. */
  ultimoUsoEn: string | null;
}

/** Las columnas que la pantalla necesita. El `token_hash` NO se lee: no se
 *  enseña, no se compara y no tiene por qué viajar. */
const COLUMNAS = 'user_id, rol, familia, emitido_en, expira_en, ultimo_uso_en, mcp_oauth_cliente(nombre)';

interface FilaToken {
  user_id: unknown;
  rol: unknown;
  familia: unknown;
  emitido_en: unknown;
  expira_en: unknown;
  ultimo_uso_en: unknown;
  mcp_oauth_cliente?: { nombre?: unknown } | Array<{ nombre?: unknown }> | null;
}

/** PostgREST devuelve el embed como objeto o como arreglo de uno según cómo
 *  resuelva la cardinalidad; las dos formas dicen lo mismo. */
function nombreDeCliente(f: FilaToken): string | null {
  const c = f.mcp_oauth_cliente;
  const uno = Array.isArray(c) ? c[0] : c;
  const n = uno?.nombre;
  return typeof n === 'string' && n.length > 0 ? n : null;
}

function masReciente(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** Agrupa tokens vivos en familias. Nuevas primero (por `otorgadoEn`). */
function agruparPorFamilia(filas: FilaToken[]): ClienteMcpConectado[] {
  const porFamilia = new Map<string, ClienteMcpConectado>();
  for (const f of filas) {
    const familia = String(f.familia);
    const otorgadoEn = String(f.emitido_en);
    const expiraEn = String(f.expira_en);
    const ultimoUsoEn = f.ultimo_uso_en == null ? null : String(f.ultimo_uso_en);
    const previo = porFamilia.get(familia);
    if (!previo) {
      porFamilia.set(familia, { familia, cliente: nombreDeCliente(f), otorgadoEn, ultimoUsoEn, expiraEn });
      continue;
    }
    // El acceso y el refresco de una misma rotación tienen fechas distintas:
    // «otorgado» es la más VIEJA (cuándo empezó esto) y «expira» la más
    // LEJANA (hasta cuándo alcanza sin refrescar). Las dos son la verdad.
    if (Date.parse(otorgadoEn) < Date.parse(previo.otorgadoEn)) previo.otorgadoEn = otorgadoEn;
    if (Date.parse(expiraEn) > Date.parse(previo.expiraEn)) previo.expiraEn = expiraEn;
    previo.ultimoUsoEn = masReciente(previo.ultimoUsoEn, ultimoUsoEn);
    if (previo.cliente === null) previo.cliente = nombreDeCliente(f);
  }
  return [...porFamilia.values()]
    .sort((a, b) => Date.parse(b.otorgadoEn) - Date.parse(a.otorgadoEn));
}

/**
 * La consulta base: tokens VIVOS de una flota.
 *
 * «Vivo» son las DOS condiciones juntas — `revocado_en is null` Y todavía sin
 * expirar. Un token expirado que siguiera pintado invitaría a revocar algo que
 * ya no abre nada, y la lista dejaría de contestar la única pregunta que
 * importa: ¿quién puede leer los datos de mi flota AHORA MISMO?
 */
function consultaViva(tenantId: string, ahora: string) {
  return supabaseAdmin().from('mcp_oauth_token')
    .select(COLUMNAS)
    .eq('tenant_id', tenantId)
    .is('revocado_en', null)
    .gt('expira_en', ahora)
    .order('emitido_en', { ascending: false });
}

/**
 * LOS CLIENTES MCP DE UN SOLO USUARIO — lo que cada quien ve de sí mismo en
 * /dashboard/mi-perfil.
 *
 * El filtro por `user_id` va EN LA CONSULTA, no en un `.filter()` de
 * JavaScript después: filtrar en memoria significa que las filas de los demás
 * usuarios de la flota SÍ viajaron hasta este proceso, y basta un renglón mal
 * pintado para enseñárselas. Y va anclado además a `tenant_id` aunque el
 * `userId` venga de la sesión: dos anclas cuestan lo mismo que una y el día
 * que alguien reuse esta función con un id de otro lado, el ancla sobrante es
 * la que evita el incidente.
 */
export async function listarMisClientesMcp(
  tenantId: string,
  userId: string,
): Promise<ClienteMcpConectado[]> {
  const { data, error } = await acotada(
    consultaViva(tenantId, new Date().toISOString()).eq('user_id', userId),
    'listarMisClientesMcp',
  );
  if (error) throw new Error(`listarMisClientesMcp: ${error.message}`);
  return agruparPorFamilia((data ?? []) as FilaToken[]);
}

/**
 * TODAS las sesiones MCP vivas de la flota, agrupadas por usuario — la vista
 * del dueño en /dashboard/sesiones-mcp.
 *
 * El nombre y el correo salen de `app_user` y no del token: `user_email` viaja
 * en NULL desde la pantalla de consentimiento (autorizar/page.tsx lo dice y lo
 * explica), así que confiar en la columna congelada dejaría la lista sin una
 * sola forma de saber a quién se le está cortando el acceso. La lectura de
 * `app_user` va anclada al MISMO tenant: un id que no sea de esta flota no
 * resuelve nombre, y por tanto no se puede pintar prestado.
 */
export async function listarSesionesMcp(tenantId: string): Promise<SesionMcpUsuario[]> {
  const { data, error } = await acotada(
    consultaViva(tenantId, new Date().toISOString()),
    'listarSesionesMcp',
  );
  if (error) throw new Error(`listarSesionesMcp: ${error.message}`);

  const filas = (data ?? []) as FilaToken[];
  const porUsuario = new Map<string, { rol: string; filas: FilaToken[] }>();
  for (const f of filas) {
    const id = String(f.user_id);
    const previo = porUsuario.get(id);
    if (previo) previo.filas.push(f);
    // `filas` viene ordenada por `emitido_en` desc: el primer renglón de cada
    // usuario es su token MÁS NUEVO, así que el rol que se enseña es el del
    // consentimiento más reciente y no el de uno de hace dos meses.
    else porUsuario.set(id, { rol: String(f.rol), filas: [f] });
  }
  if (porUsuario.size === 0) return [];

  const ids = [...porUsuario.keys()];
  const { data: personas, error: eP } = await acotada(supabaseAdmin().from('app_user')
    .select('id, nombre, email')
    .eq('tenant_id', tenantId)
    .in('id', ids), 'listarSesionesMcp.usuarios');
  if (eP) throw new Error(`listarSesionesMcp: ${eP.message}`);

  const nombres = new Map<string, { nombre: string | null; email: string | null }>();
  for (const p of (personas ?? []) as Array<Record<string, unknown>>) {
    nombres.set(String(p.id), {
      nombre: p.nombre == null ? null : String(p.nombre),
      email: p.email == null ? null : String(p.email),
    });
  }

  const salida: SesionMcpUsuario[] = [];
  for (const [userId, { rol, filas: suyas }] of porUsuario) {
    const clientes = agruparPorFamilia(suyas);
    const persona = nombres.get(userId);
    salida.push({
      userId,
      nombre: persona?.nombre ?? null,
      email: persona?.email ?? null,
      rol,
      clientes,
      ultimoUsoEn: clientes.reduce<string | null>((acc, c) => masReciente(acc, c.ultimoUsoEn), null),
    });
  }
  // Quien usó su acceso más recientemente arriba; los que nunca lo usaron, al
  // final. Es el orden en que se mira una lista de accesos: primero lo vivo.
  return salida.sort((a, b) => {
    if (a.ultimoUsoEn === b.ultimoUsoEn) return 0;
    if (a.ultimoUsoEn === null) return 1;
    if (b.ultimoUsoEn === null) return -1;
    return Date.parse(b.ultimoUsoEn) - Date.parse(a.ultimoUsoEn);
  });
}

/**
 * CORTA todos los accesos MCP de un usuario en esta flota.
 *
 * Es el primer llamador de `revocar_mcp_oauth_usuario` (0265). El aislamiento
 * lo garantiza la función misma —su `update` lleva `tenant_id = p_tenant` en
 * el `where`—, y `p_tenant` viene del `tenantId` de la sesión del servidor,
 * nunca del formulario: con el uuid de un usuario de OTRA flota el update toca
 * CERO filas y aquí se contesta con un `DatoInvalido`, no con un «listo».
 *
 * Que devuelva 0 no es éxito silencioso, por el mismo motivo que en
 * `revocarLlaveApi`: sin mirar el conteo, la pantalla diría «cortado» sobre un
 * acceso que sigue vivo — y sobre credenciales esa mentira es la peor de
 * todas. Devuelve cuántos tokens tumbó para poder decirlo en pantalla.
 */
export async function revocarSesionesMcp(
  tenantId: string,
  usuarioId: string,
  revocadoPor?: string,
): Promise<number> {
  if (!esUuidValido(usuarioId)) {
    throw new DatoInvalido('No se reconoce a ese usuario. Vuelve a abrir la pantalla.');
  }

  const { data, error } = await acotada(supabaseAdmin()
    .rpc('revocar_mcp_oauth_usuario', { p_tenant: tenantId, p_usuario: usuarioId }),
    'revocarSesionesMcp');

  if (error) throw new Error(`revocarSesionesMcp: ${error.message}`);
  // `bigint` vuelve como número o como cadena según el serializador; las dos
  // formas dicen lo mismo y `Number` las cubre.
  const tumbados = Number(data ?? 0);
  if (!Number.isFinite(tumbados) || tumbados <= 0) {
    throw new DatoInvalido('No hay ninguna sesión MCP viva de ese usuario en tu flota. Puede que ya se hubiera cortado — recarga la pantalla.');
  }

  // Best-effort, igual que en `llave-api-escritura`: los tokens YA se
  // revocaron, y tirar la operación por no poder anotarla dejaría el sistema
  // peor que sin el registro. Quién cortó el acceso de quién no tiene columna
  // en `mcp_oauth_token` — esta anotación es su única memoria.
  await anotarBitacora(
    {
      tenantId,
      actor: { id: revocadoPor },
      accion: 'mcp.sesiones_revocadas',
      entidad: 'mcp_oauth_token',
      entidadId: usuarioId,
      detalle: { tokens: tumbados },
    },
    { evento: 'mcp.sesiones.bitacora_no_escribio' },
  );

  return tumbados;
}
