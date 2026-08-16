import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { sinComentarios, fuentesDeProduccion } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// CAPA 2 DEL AISLAMIENTO — LA QUE DE VERDAD PROTEGE EL CAMINO REAL.
//
// El dato verificado que reordenó esta ronda: la app consulta con
// `service_role` (`src/lib/supabase/admin.ts`, `supabaseAdmin()`), y
// `service_role` SALTA RLS por diseño (confirmado contra `supabase/
// migrations/0064:187` y contra el propio comentario de `admin.ts`: "Salta
// RLS — re-imponer scope por tenant a mano con .eq('tenant_id', ...)"). O
// sea que RLS (capa 1, `supabase/pruebas-aislamiento/*.sql` +
// `verificaciones.sql`) es la SEGUNDA red — la que protege una sesión de
// navegador con el rol `authenticated`. La PRIMERA red, la que separa a una
// flota de otra en el camino que de verdad usa el producto, es el filtro
// `tenant_id` que cada consulta escribe a mano. Esta prueba vigila esa
// primera red.
//
// QUÉ HACE: escanea todo `.ts` de producción bajo `src/lib/**` que importe
// `supabaseAdmin` de `@/lib/supabase/admin`, encuentra cada `.from('tabla')`
// contra una tabla que SÍ tiene `tenant_id` (la lista sale de
// `supabase/migrations/*.sql` en cada corrida — una migración nueva que le
// agregue `tenant_id` a una tabla entra sola, sin tocar este archivo), y
// exige que la cadena que sigue mencione `tenant_id` en alguna parte —
// `.eq('tenant_id', …)`, `.match({tenant_id: …})`, `.in('tenant_id', …)` — o
// que el llamador esté en el ALLOWLIST de abajo, con su razón escrita.
//
// SUS LÍMITES, para no fingir más certeza de la que da (es un escaneo de
// FUENTE, no una ejecución):
//
// · "la cadena MENCIONA tenant_id" no es "la cadena FILTRA correctamente
//   por tenant_id". `.eq('tenant_id', OTRO_TENANT_ID)` —el id equivocado—
//   pasaría esta prueba y sería un IDOR real. Esto atrapa el olvido total
//   del filtro (el caso que de verdad ha pasado: ver el comentario de
//   `clientes.ts` sobre `crearViaje`/`operador_id`), no un id trocado.
// · Solo mira `src/lib/**`. Una consulta armada dentro de `src/app/**`
//   (poco común en este repo — la convención es que las páginas llamen a
//   funciones de `lib/`, nunca arman su propio `.from()`) no la ve esta
//   prueba. Si esa convención se rompe, hace falta ampliar el escaneo.
// · La ventana que se lee tras cada `.from(` es de hasta 2000 caracteres o
//   hasta que los paréntesis abiertos por la propia cadena vuelvan a cero
//   —lo que pase primero—. Una cadena de supabase-js más larga que eso es
//   un olor de código por su cuenta; hasta hoy (15-ago-2026) ninguna lo es.
// · No sigue funciones. Si una tabla se consulta a través de un helper
//   genérico que reciba el nombre de tabla como parámetro (no hay ninguno
//   así hoy — se confirmó con `grep -rn "\.from(nombreTabla\|\.from(tabla"`),
//   esta prueba no lo vería.
// ═══════════════════════════════════════════════════════════════════════════

const DIR_LIB = 'src/lib';
const DIR_MIGRACIONES = 'supabase/migrations';

/**
 * Tablas de `public` con columna `tenant_id`, generada de los propios
 * `.sql` — no una lista escrita a mano que se desactualiza. Solo entiende
 * `create table` (con o sin `if not exists`) y `drop table`: es lo único
 * que las 111 migraciones de hoy usan (no hay un solo `rename` ni un `add
 * column tenant_id` posterior a la creación — confirmado por grep), y basta
 * para el caso que le importa a esta prueba: una tabla nueva que declare
 * `tenant_id` en su propio `create table` se detecta sola.
 */
function tablasConTenantId(): Set<string> {
  const archivos = readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  const conTenant = new Set<string>();
  const dropeadas = new Set<string>();

  const reCreate = /create table\s+(?:if not exists\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\);/gi;
  const reDrop = /drop table\s+(?:if exists\s+)?(?:public\.)?"?(\w+)"?/gi;

  for (const f of archivos) {
    const src = readFileSync(`${DIR_MIGRACIONES}/${f}`, 'utf8');
    let m: RegExpExecArray | null;
    reCreate.lastIndex = 0;
    while ((m = reCreate.exec(src))) {
      if (/\btenant_id\b/.test(m[2])) conTenant.add(m[1]);
    }
    reDrop.lastIndex = 0;
    while ((m = reDrop.exec(src))) dropeadas.add(m[1]);
  }
  for (const t of dropeadas) conTenant.delete(t);
  return conTenant;
}

/** ¿El archivo importa el cliente de service-role? Solo esos saltan RLS. */
const IMPORTA_ADMIN = /from\s+['"]@\/lib\/supabase\/admin['"]/;

/** Cada llamada `.from('tabla')`, con su posición en el fuente. */
function llamadasFrom(fuente: string): Array<{ tabla: string; desde: number }> {
  const re = /\.from\(\s*['"](\w+)['"]\s*\)/g;
  const salida: Array<{ tabla: string; desde: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(fuente))) salida.push({ tabla: m[1], desde: m.index });
  return salida;
}

/** Nombres de método de supabase-js: no son "funciones locales que construyen la fila". */
const NOMBRES_SUPABASE = new Set([
  'from', 'select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'is', 'match',
  'filter', 'order', 'range', 'limit', 'single', 'maybeSingle', 'then', 'catch', 'rpc',
  'contains', 'not', 'or', 'gte', 'lte', 'gt', 'lt', 'ilike', 'like', 'textSearch', 'returns',
  'throwOnError', 'csv', 'overlaps', 'containedBy',
]);

/** Avanza desde un '{' hasta su '}' que lo balancea (o hasta el final del fuente). */
function finDeLlaves(fuente: string, desdeLlave: number): number {
  let balance = 0;
  let i = desdeLlave;
  for (; i < fuente.length; i++) {
    if (fuente[i] === '{') balance++;
    else if (fuente[i] === '}') { balance--; if (balance === 0) return i + 1; }
  }
  return i;
}

/**
 * `function nombre(...) { ... }` o `const nombre = (...) => { ... }` de nivel
 * módulo — para poder mirar el CUERPO de un `filaTarifa(tenantId, t)` cuando
 * el `.insert(filaTarifa(...))` no trae `tenant_id` a la vista pero la fila
 * que arma sí. Es texto, no un parser de TypeScript: basta para lo que se
 * necesita (encontrar el bloque `{…}` que sigue a una firma de función) y
 * un caso que no calce cae, con seguridad, del lado de SEGUIR exigiendo el
 * filtro explícito.
 */
function cuerposDeFunciones(fuente: string): Map<string, string> {
  const mapa = new Map<string, string>();
  const re = /(?:function\s+(\w+)\s*\([^)]*\)\s*(?::[^{]+)?|(?:export\s+)?(?:async\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fuente))) {
    const nombre = m[1] ?? m[2];
    const abre = fuente.indexOf('{', re.lastIndex - 1);
    if (abre === -1) continue;
    const fin = finDeLlaves(fuente, abre);
    mapa.set(nombre, fuente.slice(abre, fin));
  }
  return mapa;
}

/**
 * Para un `.insert(…)`/`.upsert(…)` cuya cadena no menciona `tenant_id`: la
 * fila puede armarse ANTES, en la misma función (una constante que luego se
 * pasa por nombre) o en un helper del propio archivo (`filaTarifa(tenantId,
 * t)`). Se amplía la ventana al cuerpo de la función que envuelve la
 * llamada, más el cuerpo de cualquier función local que esa envolvente
 * invoque.
 *
 * SOLO para INSERT/UPSERT — nunca para SELECT/UPDATE/DELETE: la fila de un
 * insert se juzga por lo que CONTIENE (puede venir de otro lado), pero un
 * SELECT/UPDATE/DELETE se juzga por lo que FILTRA, y eso tiene que estar en
 * la propia cadena — "en algún lugar de esta función grande se menciona
 * tenant_id" no basta para saber que ESTE where lo usa.
 */
function ventanaAmpliadaParaEscritura(fuente: string, desdeFrom: number): string {
  const antes = fuente.slice(0, desdeFrom);
  const firmaRe = /(?:function\s+\w+\s*\([^)]*\)\s*(?::[^{]+)?|(?:export\s+)?(?:async\s+)?const\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>)\s*\{/g;
  let ultima: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = firmaRe.exec(antes))) ultima = m;
  if (!ultima) return '';
  const abre = antes.indexOf('{', ultima.index + ultima[0].length - 1);
  if (abre === -1) return '';
  const fin = finDeLlaves(fuente, abre);
  if (fin <= desdeFrom) return ''; // el `.from(` quedó FUERA de esa función: no aplica

  const envolvente = fuente.slice(abre, fin);
  const cuerpos = cuerposDeFunciones(fuente);
  const llamadas = new Set(
    [...envolvente.matchAll(/\b([a-zA-Z_]\w*)\(/g)].map((mm) => mm[1]).filter((n) => !NOMBRES_SUPABASE.has(n)),
  );
  let extra = '';
  for (const n of llamadas) if (cuerpos.has(n)) extra += ' ' + cuerpos.get(n);
  return envolvente + extra;
}

/** Avanza desde un '(' hasta su ')' que lo balancea (o hasta `fin`). */
function finDelGrupo(fuente: string, desdeParen: number, fin: number): number {
  let balance = 0;
  let i = desdeParen;
  for (; i < fin; i++) {
    if (fuente[i] === '(') balance++;
    else if (fuente[i] === ')') {
      balance--;
      if (balance === 0) return i + 1;
    }
  }
  return i;
}

/**
 * La CADENA COMPLETA que arranca en un `.from(`: su propia llamada, y cada
 * `.metodo(…)` encadenado que le sigue — `.from('cliente').select(…)
 * .eq('tenant_id', x).order(…)` es UNA cadena, no cuatro grupos sueltos.
 * Para en lo que venga primero: algo que no sea otro `.metodo(` encadenado,
 * o 2000 caracteres.
 */
function ventanaDeCadena(fuente: string, desde: number): string {
  const TOPE = 2000;
  const fin = Math.min(fuente.length, desde + TOPE);

  const primerParen = fuente.indexOf('(', desde);
  if (primerParen === -1 || primerParen >= fin) return fuente.slice(desde, fin);
  let i = finDelGrupo(fuente, primerParen, fin);

  for (;;) {
    let j = i;
    while (j < fin && /\s/.test(fuente[j])) j++; // espacios/saltos de línea entre eslabones
    if (fuente[j] !== '.') break;
    let k = j + 1;
    while (k < fin && /\w/.test(fuente[k])) k++; // nombre del método
    if (fuente[k] !== '(') break; // no es una llamada — fin de la cadena
    const siguiente = finDelGrupo(fuente, k, fin);
    if (siguiente === k) break; // no cerró dentro de la ventana
    i = siguiente;
  }
  return fuente.slice(desde, i);
}

/**
 * Llamador exento, con la razón por la que SÍ puede cruzar tenants o por la
 * que el escaneo no puede verlo (falso positivo conocido). Cada entrada es
 * `archivo:tabla` o `archivo:tabla:snippet` cuando una tabla se toca más de
 * una vez en el mismo archivo con destinos distintos.
 */
const ALLOWLIST: Record<string, string> = {
  'src/lib/admin/negocio.ts': 'CLAUDE.md la nombra, textual, como "la única función con ese permiso": la consola /admin (superadmin) cruza TODOS los tenants a propósito para ver costo de IA, flotas y agentes de TODAS las flotas a la vez.',
  'src/lib/admin/corridas-cruzadas.ts': 'El nombre lo dice: compara la corrida de un agente ENTRE flotas para detectar anomalías (una flota con un patrón muy distinto a las demás). Es analítica cross-tenant del superadmin, no una fuga hacia el panel de un cliente — /admin es la única superficie que la sirve.',
  'src/lib/likida/startup.ts': 'Sondas de arranque (health checks) que confirman que el ESQUEMA existe y responde — cuentan filas o verifican metadatos de la base entera, no leen ni exponen el contenido de ningún tenant específico.',

  // Las seis de abajo se revisaron UNA POR UNA el 15-ago-2026 (no de bulto):
  // se siguió cada llamador hasta confirmar por qué el id que usa NO puede
  // venir de otro tenant. La razón de cada una es distinta a propósito —
  // copiar-pegar la misma frase en las seis habría sido la señal de que no
  // se revisó ninguna.
  'src/lib/auth/llave-api.ts': '`resolverLlave`: el `.eq(\'id\', hallada.id)` del sello de "último uso" opera sobre una fila que YA se autenticó por comparación de HASH de la llave en claro contra `tenant_api_key.hash` (líneas 140-161) — no por tenant_id. El id no puede ser de otro tenant porque salió de la fila que ganó esa comparación criptográfica, no de un parámetro externo.',
  'src/lib/likida/conv.ts': 'Cada `convId`/`viajeId` que llega a `saveConversation`/`intakePendientes` sale de una resolución YA filtrada por tenant, más arriba en el MISMO pipeline de WhatsApp: `loadConversation(tenantId, telefono, ...)` hace `.eq(\'tenant_id\', tenantId).eq(\'telefono\', telefono)` (línea 235) antes de devolver el `id` que usa `saveConversation`, y todo llamador de `esperarIntake`/`intakePendientes` trae `viajeId` emparejado con un `tenantId` ya resuelto por `resolveOperador(telefono)`. Rastreado hasta processor.ts (líneas 327, 1830, 1951, 2041, 2438) — ninguna ruta pasa un id sin resolver.',
  'src/lib/likida/interruptores.ts': '`listarInterruptores` resuelve NOMBRES de quién movió una palanca GLOBAL (`interruptor`, tabla sin tenant_id, deniega-todo a `authenticated`) leyendo `app_user` por los `id` que aparecen en esa bitácora — es auditoría superadmin, no un dato de flota. Su único llamador de interfaz es `/admin/observabilidad`, gateado por `requireSuperadmin()` en `admin/layout.tsx` (confirmado: ninguna ruta de `/dashboard` la importa).',
  'src/lib/likida/vendedores.ts': 'Es el pipeline de VENTAS de LIKIDA, no de una flota — lo dice el encabezado del propio archivo. `prospecto.tenant_id` es NULL hasta que el prospecto "cierra" (constraint `prospecto_tenant_solo_cerrado`, mig. 0105), y los `app_user` que toca son rol `vendedor` (tenant_id null, personal de Likida, no de una flota). El ancla real es `vendedor_id`, aplicado con `.eq(\'vendedor_id\', ...)` en cada escritura — es la regla #2 que el propio archivo documenta en su encabezado.',
  'src/lib/saas/suscripcion.ts': '`aplicarSuscripcion` (líneas 322-383): cada `.eq(\'id\', ...)` opera sobre una fila resuelta ANTES, en la MISMA función, por un identificador confiable — `stripe_subscription_id` (viene del webhook autenticado de Stripe, nunca de un usuario del panel) o `.eq(\'tenant_id\', datos.tenantId)` explícito (la búsqueda de `previa`, línea 361). Y el INSERT/UPDATE final escribe `tenant_id: datos.tenantId` de todas formas, así que aunque el id encontrado fuera de otra fila, la fila queda anclada al tenant correcto.',
  'src/lib/saas/transferencia.ts': '`conciliar`/`timbrarFactura` tocan `factura_saas` — la facturación de LIKIDA a sus clientes, no un dato de flota — y su ÚNICO llamador es `/admin/costos-facturacion` (confirmado por grep en todo `src/app`), gateado por `requireSuperadmin()` en `admin/layout.tsx`. `/dashboard` (cliente) no las importa.',
};

const tenantTablas = tablasConTenantId();
const archivosLib = fuentesDeProduccion(DIR_LIB).filter((f) => f.endsWith('.ts'));

type Hallazgo = { archivo: string; tabla: string; contexto: string };

const hallazgos: Hallazgo[] = [];
for (const archivo of archivosLib) {
  const original = readFileSync(archivo, 'utf8');
  if (!IMPORTA_ADMIN.test(original)) continue;
  const fuente = sinComentarios(original);
  if (!IMPORTA_ADMIN.test(fuente)) continue; // el import mismo no es un comentario, pero por si acaso

  for (const { tabla, desde } of llamadasFrom(fuente)) {
    if (!tenantTablas.has(tabla)) continue;
    const ventana = ventanaDeCadena(fuente, desde);
    if (/tenant_id/.test(ventana)) continue; // menciona tenant_id en su propia cadena: pasa

    // Solo para escrituras nuevas: la fila de un INSERT/UPSERT se juzga por
    // lo que CONTIENE, y eso puede venir armado antes, en la misma función o
    // en un helper del archivo (`filaTarifa(tenantId, t)`). Un SELECT/UPDATE/
    // DELETE se juzga por lo que FILTRA, y eso tiene que estar en la propia
    // cadena — no se amplía la ventana para esos.
    if (/\.(?:insert|upsert)\(/.test(ventana)) {
      const ampliada = ventanaAmpliadaParaEscritura(fuente, desde);
      if (/tenant_id/.test(ampliada)) continue;
    }

    if (ALLOWLIST[archivo]) continue; // exento a nivel de archivo, con su razón

    hallazgos.push({ archivo, tabla, contexto: ventana.slice(0, 140).replace(/\s+/g, ' ') });
  }
}

describe('capa 2 · toda consulta con supabaseAdmin contra una tabla con tenant_id la filtra', () => {
  it('encontró archivos que importan supabaseAdmin (si no, el escaneo no está mirando nada)', () => {
    const conAdmin = archivosLib.filter((f) => IMPORTA_ADMIN.test(readFileSync(f, 'utf8')));
    expect(conAdmin.length).toBeGreaterThan(20);
  });

  it('la lista de tablas con tenant_id salió de las migraciones (si no, nada se está comparando)', () => {
    expect(tenantTablas.size).toBeGreaterThan(20);
  });

  it('ninguna consulta se queda sin el filtro ni sin una exención con razón', () => {
    expect(
      hallazgos,
      `estas consultas con supabaseAdmin tocan una tabla con tenant_id sin que ` +
        `\`tenant_id\` aparezca en su propia cadena, y el archivo no está en el ALLOWLIST:\n\n` +
        hallazgos.map((h) => `  ${h.archivo} → .from('${h.tabla}')\n    ${h.contexto}…`).join('\n\n') +
        `\n\nSi es un olvido real del filtro: agrégalo. Si es a propósito (como ` +
        `\`lib/admin/negocio.ts\`): añade el archivo al ALLOWLIST de este archivo, con la razón.`,
    ).toEqual([]);
  });
});
