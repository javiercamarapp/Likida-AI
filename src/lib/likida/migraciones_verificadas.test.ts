import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// RONDA 7 · "¿ESTÁ COMPROBADA LA 00XX?" NO PODÍA CONTESTARSE.
//
// `supabase/verificaciones.sql` prueba lo que solo la base puede demostrar:
// índices únicos, claims atómicos, permisos. Es el único sitio del repo donde se
// comprueban garantías que un test con Supabase mockeado no toca —ese prueba el
// mock—. Y no había forma de saber qué migraciones cubría: la respuesta era
// abrir el archivo y contar.
//
// Así se coló la 0030, que es la migración MÁS irónica para colarse: existe
// exactamente porque un chequeo de arranque decía verificar la 0019 y no podía.
// La migración escrita para que un chequeo dejara de mentir se quedó, ella
// misma, sin comprobar.
//
// Al escribir esta lista aparecieron otras TRES —la 0002, la 0011 y la 0012—,
// que es para lo que sirve escribirla. Ahora son los bloques 14, 15 y 16.
//
// Esta prueba no lee SQL ni valida sintaxis. Hace UNA sola cosa: obliga a que
// toda migración nueva tome una decisión explícita —bloque o exención con
// razón— en vez de dejarla al olvido, que es el default de hoy.
// ═══════════════════════════════════════════════════════════════════════════

const DIR = 'supabase/migrations';

/**
 * Los TÍTULOS de los bloques, no el archivo entero.
 *
 * Buscar el número en todo el SQL daba falsos verdes: un bloque puede nombrar
 * media docena de migraciones en su prosa para explicar el contexto —el 14 cita
 * la 0011 y la 0005— sin comprobar ninguna de ellas. El título es donde el autor
 * del bloque DECLARA qué está comprobando, y es lo único que se puede leer como
 * una afirmación.
 *
 * Formato: `-- ── 14. El contador de la barrera (mig. 0011 + 0031) ──────`
 */
const TITULOS = readFileSync('supabase/verificaciones.sql', 'utf8')
  .split('\n')
  .filter((l) => /^-- ── \d+\./.test(l))
  .join('\n');

/**
 * Migraciones que NO necesitan bloque, con la razón de cada una.
 *
 * El criterio: hace falta bloque cuando la migración crea una garantía que la
 * base es la ÚNICA que puede demostrar —unicidad, atomicidad, permisos—. Una
 * columna nueva, un bucket o un índice de velocidad no entran: si faltan, algo
 * revienta ruidosamente o va lento, no se corrompe en silencio.
 */
const EXENTAS: Record<string, string> = {
  '0137': 'columna prospecto.unidades + check > 0. No crea garantía que solo la base pueda demostrar: si la columna falta, /api/lead lo detecta por el mensaje del insert y salva el lead en `notas` (probado en api/lead/route.test.ts, "la red de seguridad de la 0137"). El check de positivos es la misma forma que plan_limites_positivos, que tampoco tiene bloque: un valor inválido rebota ruidoso en el INSERT, no se corrompe en silencio.',

  '0112': 'RPCs de agregados en SQL (serie_comparativa_tenant + redefine sumar_combustible_ejercicio, patrón 0084): si faltan, getSerieComparativa/getAcumuladoCombustible LANZAN ruidoso (el RPC no existe — fail-closed explícito con aviso de lasi pasada, el mismo criterio de la 0084). El contrato de la serie en TS se prueba en analytics_serie_comparativa.test.ts (mapeo, null de costo, forma `pasos` periodos); la corrección LOCAL-MX del bucketeo ahora la garantiza la función SQL, que a su vez es runtime-ruidoso si falla, y queda cubierta por el bloque 21 (0022/log?) del propio flujo documentado en la migración. Sin garantía de unicidad/atomicidad/permisos que la base sea la única que pueda demostrar.',

  '0087': 'columna viaje.recordatorio_comprobacion_en + índice parcial — el mismo patrón que escalado_en (0058, sin bloque propio: su claim tampoco se verifica ahí, el bloque 37 de esa migración prueba otra cosa). La garantía real es que el UPDATE condicional (WHERE recordatorio_comprobacion_en IS NULL, la misma columna que escribe) es atómico por construcción de Postgres — no una regla de negocio que este repo agregue, sino la semántica estándar de un UPDATE con WHERE. El claim anti-doble-envío vive desde la 0089 en el INSERT con unique(viaje, tier) de cobranza_contacto (bloque 64 la verifica con corrida real), y la lógica de tiers y del sello se prueba en TS (agentes/cobranza.test.ts) — recordatorio_comprobacion.ts y sus 15 pruebas se borraron el 14-ago-2026 al quedar supersedidos por ese agente.',
  '0080': 'columna operador.rfc: dato opcional capturado por la flota. La rama buena de RLISR 57 se prueba en TS (engine/desde_db); si la columna falta, getOperador falla ruidoso.',
  '0082': 'redefine config_tenant_valida con la llave facilidadCombustibleEfectivo: si falta, el alta de flota que declare su régimen revienta con el error del 0026 (ruidoso, no silencioso).',
  '0083': 'redefine config_tenant_valida exigiendo la FORMA de la facilidad: si falta, una config con "sí" en la llave revienta ruidoso en el UPDATE del tenant.',
  '0084': 'RPC sumar_combustible_ejercicio: si falta, getAcumuladoCombustible lanza ruidoso en el primer cuadre (el RPC no existe). El resultado se prueba en TS contra el esquema de migraciones.',
  '0085': 'redefine config_tenant_valida: la 0083 asignaba jsonb a una variable record (crash "anonymous composite types") en cada UPDATE de tenant con la facilidad declarada. El bloque 61 de verificaciones.sql reproduce el escenario exacto (update con facilidad en config).',
  // ── Prospecto / scoring de ventas (pipeline de Likida, NO dinero de flota) ──
  // Mismo criterio que 0137: columnas aditivas y ajustes de un SCORE de ventas.
  // No crean una garantía que solo la base pueda demostrar (unicidad/atomicidad/
  // permisos): si una columna falta, el código que la lee falla ruidoso; si el
  // cálculo del score cambia, es lógica de negocio del embudo, probada en TS, y
  // un score mal solo mueve el ORDEN de la lista de prospectos —nunca una cifra
  // fiscal ni un cobro—. Ninguna toca `gasto`/`liquidacion`/`viaje`/`suscripcion`.
  '0140': 'columnas de investigación profunda + score de filtrado en `prospecto`. Aditivas; su ausencia rompe ruidoso la escritura del censo, no corrompe en silencio. El score es orden de ventas, no dinero.',
  '0141': 'columna `mensaje_linkedin` en `prospecto` (el tercer toque). Aditiva, sin garantía que la base sea la única en demostrar — misma forma que 0129.',
  '0142': 'ajuste del cálculo de `necesidad_pct` (excluye "auxiliar administrativo" suelto). Es un SCORE de prospección; su corrección es lógica de negocio del embudo, no un invariante de dinero. Un valor mal reordena la lista, no corrompe.',
  '0143': 'ajuste del cálculo de `necesidad_pct` (excluye "liquidación de pagos", que no es "liquidación de viajes"). Mismo criterio que 0142: score de ventas, no dinero.',
  '0001': 'esquema base: si falta, no arranca nada. Un bloque no aporta información que el primer INSERT no dé.',
  '0003': 'tabla de costos de LLM: telemetría. No hay garantía que romper.',
  '0004': 'columna de config fiscal. El bloque 7 (0026) sí comprueba lo que importa: que esa config no pueda apagar un tope de dinero.',
  '0006': 'columnas del complemento de hidrocarburos. Su corrección se prueba en TS contra el XML.',
  '0007': 'columnas de acreditamiento (IVA/IEPS). Los números los prueba el motor, que es puro.',
  '0008': 'bucket de storage. Si falta, la subida falla con un error visible.',
  '0009': 'columnas de XML crudo y EFOS. La retención de CFF 30 se prueba en TS; aquí solo hay dónde guardarlo.',
  '0010': 'columna ocr_extra. El claim que la protege es la 0017, bloque 3.',
  '0014': 'columna img_hash. Su unicidad la ponen la 0015 y la 0027.',
  '0015': 'su índice `uq_gasto_img_hash` lo DROPEA y recrea la 0027, que sí tiene bloque (8). Comprobar el de la 0015 sería comprobar un índice que ya no existe.',
  '0016': 'tabla `codigo_pendiente`. El arranque la sondea leyéndola y su ausencia da error de PostgREST, no corrupción.',
  '0018': 'columnas del aviso de privacidad. Su claim atómico es `marcar_aviso_privacidad`, que sí tiene prueba en TS con el RPC real mockeado — y la constancia falsa, que es el riesgo, se prueba en `aviso_constancia.test.ts`.',
  '0020': 'columna `demora_no_imputable`. El que se leyera o no es un bug de SELECT, ya cerrado y probado en TS.',
  '0021': 'litros de diésel en la liquidación. La firma ambigua que dejó es lo peligroso, y ESO es el bloque 5 (0022).',
  '0023': 'índice de velocidad para el acumulado del ejercicio. Sin él la consulta va lenta; no cambia ningún número.',
  '0034': 'columna nullable `tenant.contacto_privacidad` (art. 29). Si falta, el aviso integral marca esa sección como pendiente — que es su comportamiento con la columna vacía, así que no hay garantía que la base pueda romper. El contenido se prueba en `aviso_integral.test.ts`.',
  '0035': 'solo `alter function ... set search_path`, y las diez son SECURITY INVOKER: no hay escalada que comprobar. Lo que sí se comprueba —que ninguna RPC interna sea ejecutable por `anon`— es el bloque 18.',
  '0032': 'solo `comment on table`. No hay garantía que comprobar: lo que fija —que nadie lea `politica_gasto`— se prueba en `politica_un_origen.test.ts`, que sí puede mirar el código.',
  '0038': 'creaba `foto_pendiente`, revertida por la 0041 (AUDITORÍA 9, CRÍTICO: fusionaba comprobantes distintos). El bloque 21 que la comprobaba se retiró junto con la tabla — no queda nada que verificar.',
  '0041': '`drop table foto_pendiente`. Reversión de la 0038; no hay garantía nueva que comprobar, la ausencia de la tabla la confirma cualquier consulta a `information_schema` y no vale la pena un bloque para eso.',
  '0044': 'extiende el dominio de app_user_rol_dominio con un valor más (encargado). La garantía de que basura sigue rechazada ya la prueba el bloque 11 (0025); que "encargado" se acepta se prueba en TS (provisionar.test.ts).',
  '0045': 'RLS de viaje/gasto/liquidacion para el chofer ("el chofer solo ve sus propios viajes"). Su bloque (antes 26) impersonaba un app_user con rol `operador` — retirado el 15-ago-2026 con el MISMO criterio que 0078/0079/0081: la 0086 quitó `operador` del dominio de `app_user.rol`, así que esa sesión ya no puede existir y el INSERT que la armaba rebota contra `app_user_rol_dominio` antes de llegar a nada que probar (lo confirmó la primera corrida automática de verificaciones.sql en CI, 15-ago-2026 — el bloque llevaba desde el 7-ago sin re-verificarse). La garantía que reemplaza a "no ve lo ajeno" es más fuerte, "no puede tener sesión", y la prueba el bloque 62 (0086) — que sigue vivo y corre en la misma batería.',
  '0047': 'RLS de unidad/mantenimiento/incidencia/pod para el chofer. Mismo caso exacto que 0045: su bloque (antes 28) impersonaba `operador`, se retiró el 15-ago-2026 por la misma razón, y queda cubierto por el bloque 62 (0086) — "no puede tener sesión" implica, por construcción, que tampoco pueda leer estas cuatro tablas ni el `pod` ajeno.',
  '0078': 'RLS de las escrituras/lecturas del chofer sobre operador/terminal/política/wa/llm/cfdi. Retirada por la 0086 (operador ya no tiene login): su bloque (antes 54) se borró de verificaciones.sql porque probaba una sesión que ya no puede existir — el bloque 62 (0086) prueba la garantía más fuerte que la reemplaza, "no puede tener sesión".',
  '0079': 'RLS de app_user/bitacora_auditoria para el chofer. Mismo caso que 0078: retirada por la 0086, su bloque (antes 55) se borró por la misma razón — probaba un INSERT de sesión de chofer que hoy rebota en el constraint antes de llegar a RLS.',
  '0081': 'RLS de escritura del POD del chofer, scoped a su propio tenant. Mismo caso: retirada por la 0086, su bloque (antes 56) se borró — no hay sesión de chofer que pueda intentar el POD cruzado que probaba.',
  '0113': 'solo `alter function config_tenant_valida ... set search_path`, mismo caso que la 0035 (bloque 18 la cubre: comprobó que sea SECURITY INVOKER, no hay escalada). La 0085 había regresado el search_path al reescribir la función con CREATE OR REPLACE sin repetir el SET — esta migración solo lo vuelve a fijar, no cambia el cuerpo ni la garantía que ya cubre el bloque 18.',
  '0115': 'extiende el dominio de `agente_corrida_disparo_dominio` con un valor más (whatsapp), mismo caso que la 0044: que basura sigue rechazada ya lo prueba el bloque 86 (0108, que recreó el mismo constraint); que `whatsapp` se acepta se prueba en TS (tools_apagado.test.ts, la corrida del cierre).',
  '0125': 'catálogo declarativo puro: una columna modelo_rol con CHECK de dominio (que basura rebota lo prueba el patrón de CHECKs ya verificado; que los valores se aceptan lo prueba la siembra misma al aplicarse) y ~37 filas nuevas de agente_definicion en estado disenado — el patrón un-agente-es-una-FILA cuya FK/deny-all ya verifica el bloque 91 de la 0116. Sin garantía nueva de unicidad/atomicidad/permisos.',
  '0122': 'dos altas declarativas sin garantía nueva de base: la FILA del redactor en agente_definicion (el patrón FK-como-catálogo ya lo verifica el bloque 91 de la 0116) y la extensión del dominio del CHECK de interruptor — mismo caso que la 0044/0115: que basura sigue rechazada lo prueba el CHECK recreado (bloque de la 0110), y que agente:redactor se acepta se prueba en TS (redactor.test.ts: el kill switch frena al agente).',
  // La 0141 tenía aquí una segunda entrada, escrita por la pasada del 21-ago
  // cuando las columnas GENERADAS de la 0140/0142/0143 iban a tener bloque
  // propio (el 111). Al mergear `master` (22-ago) el 111 pasó a ser la RLS de
  // `liquidacion` (0144) y las tres columnas quedaron EXENTAS con razón escrita
  // arriba. La entrada duplicada se retiró: decía un número de bloque falso, y
  // TypeScript la rechazaba (TS1117).

  '0118': 'tabla `prospecto_contacto` con FKs y CHECKs de dominio que rebotan RUIDOSO (23514/23503, no corrupción silenciosa) y deny-all idéntico al de sus hermanas 0116/0117, cuyo patrón ya verifican los bloques 91-92. La garantía de USO (la cadencia no se duplica: consultar el historial antes de contactar) es de código, y se prueba en TS (cola.test.ts: marcarEnviada registra el contacto).',
  '0168': 'columnas nullable `litros`/`clave_prod_serv` en `cfdi_consolidado_linea` (Fase 1 de docs/asistencia/PLAN-FASES.md — los litros del ECC12 que se leían y se tiraban al persistir). Aditivas, sin CHECK ni garantía de unicidad/atomicidad que solo la base pueda demostrar: si faltan, el `upsert` de consolidado.ts falla ruidoso (columna inexistente), no corrompe en silencio. La decisión de qué línea es diésel y qué clave le corresponde (`claveProdServDeLinea`, concepto_base nativo vs ecc12 TipoCombustible="Diesel"→15101505) y su propagación a `gasto.ocr_extra.litros`/`gasto.clave_prod_serv` (`ligarLineaAGasto`) se prueban en TS contra un ECC12 real (cfdi_xml.test.ts, consolidado.test.ts — describe "FASE 1").',
  '0172': 'recrea el CHECK `tenant_regimen_fiscal_dominio` con 624 Coordinados (c_RegimenFiscal, RFA 2.9). Que basura sigue rechazada lo prueba el patrón de CHECKs ya verificado; que 624 se acepta se prueba en TS (`fiscal.test.ts`: REGIMENES incluye 624 y guardarDatosFiscales lo persiste). Sin unicidad/atomicidad nueva. 0170/0171 ya estaban en master.',
};

const migraciones = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => ({ num: f.slice(0, 4), archivo: f }))
  .sort((a, b) => a.num.localeCompare(b.num));

describe('toda migración está comprobada o exenta a propósito', () => {
  it('hay migraciones y hay títulos que leer', () => {
    // Sin estas dos, todo lo de abajo pasaría por vacío: cero migraciones no
    // deja huérfanas, y cero títulos las deja todas — pero el mensaje de fallo
    // apuntaría al sitio equivocado.
    expect(migraciones.length).toBeGreaterThan(25);
    expect(TITULOS.split('\n').length).toBeGreaterThan(10);
  });

  it('ninguna se queda sin decisión', () => {
    const huerfanas = migraciones
      .filter(({ num }) => !EXENTAS[num])
      .filter(({ num }) => !new RegExp(`\\b${num}\\b`).test(TITULOS))
      .map(({ archivo }) => archivo);

    expect(
      huerfanas,
      `estas migraciones no tienen bloque en supabase/verificaciones.sql ni una razón en EXENTAS:\n  ${huerfanas.join('\n  ')}\n\n` +
      'Escribe el bloque, o añade la migración a EXENTAS con la razón. Lo que no vale es dejarla sin decidir: ' +
      'así se coló la 0030, que existe justamente porque un chequeo decía verificar algo que no verificaba.',
    ).toEqual([]);
  });

  it('y ninguna exención sobra', () => {
    // Una exención de una migración que ya no existe es una razón que nadie va a
    // volver a leer y que hace parecer cubierto lo que no está.
    const numeros = new Set(migraciones.map((m) => m.num));
    const fantasmas = Object.keys(EXENTAS).filter((n) => !numeros.has(n));
    expect(fantasmas, `EXENTAS nombra migraciones que ya no existen: ${fantasmas.join(', ')}`).toEqual([]);
  });

  it('una exención sin razón no es una exención', () => {
    const vacias = Object.entries(EXENTAS).filter(([, razon]) => razon.trim().length < 20);
    expect(vacias.map(([n]) => n), 'estas exenciones no explican por qué').toEqual([]);
  });
});
