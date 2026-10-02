#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Verifica CONTRA LA BASE (y contra los archivos de muestra y el detector real) cada folio, tracto y cifra que citan
// docs/demo/guion-innovativos-20oct.md y docs/demo/innovativos.md. Los documentos no son la fuente de verdad: lo es lo
// sembrado. Si el seed cambia (o el documento se desactualiza), esto falla.
//
//   DEMO_DATABASE_URL='postgresql:///likida_demo' node scripts/demo/innovativos/verificar-hechos-del-guion.mjs
// Sale 0 si todo coincide; 1 si algún hecho no coincide, si una consulta no devuelve filas (base sin sembrar) o si no se
// comprobó nada. Una verificación que no encuentra nada que verificar NO pasa.
// ═══════════════════════════════════════════════════════════════════════════
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { exigirBaseLocal } from './guarda-host.mjs';

exigirBaseLocal();
const T = 'eeeeeeee-0620-4000-8000-000000000250';
const URL_DB = process.env.DEMO_DATABASE_URL;
const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..', '..', '..');
const leer = (r) => readFileSync(join(raiz, r), 'utf8');
// Se normaliza: sin negritas, sin comillas de código y con los saltos de línea del párrafo colapsados.
const norm = (t) => t.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ');
const guion = norm(leer('docs/demo/guion-innovativos-20oct.md'));
const kit = norm(leer('docs/demo/innovativos.md'));
const ambos = `${guion} ${kit}`;

const consulta = (sql) => JSON.parse(execFileSync('psql', [URL_DB, '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', `select coalesce(json_agg(x), '[]'::json) from (${sql}) x`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const miles = (n) => Number(n).toLocaleString('en-US');

let comprobados = 0; const fallas = [];
const hecho = (nombre, cumple, detalle = '') => {
  comprobados++;
  if (cumple) console.log(`  ok  ${nombre}`); else { fallas.push(`${nombre}${detalle ? ` — ${detalle}` : ''}`); console.log(`  FALLA  ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
};
const uno = (nombre, sql) => { const f = consulta(sql); if (f.length === 0) { hecho(nombre, false, 'la consulta no devolvió filas (¿base sin sembrar?)'); return null; } return f[0]; };
const dice = (nombre, texto, donde = ambos) => hecho(nombre, donde.includes(texto), `el documento no contiene «${texto}»`);

// ── 1. Conteos de la tabla «Qué hay sembrado» y del guion ──────────────────
const c = uno('conteos', `select
  (select count(*) from terminal where tenant_id = '${T}') as terminales,
  (select count(*) from unidad where tenant_id = '${T}') as tractos,
  (select count(*) from operador where tenant_id = '${T}') as operadores,
  (select count(*) from cliente where tenant_id = '${T}') as clientes,
  (select count(*) from geocerca where tenant_id = '${T}') as geocercas,
  (select count(*) from viaje where tenant_id = '${T}' and estatus = 'abierto') as en_curso,
  (select count(*) from viaje where tenant_id = '${T}' and estatus = 'liquidado') as cerrados,
  (select count(*) from viaje_hito where tenant_id = '${T}') as hitos,
  (select count(*) from posicion where tenant_id = '${T}') as posiciones,
  (select count(*) from peaje_caseta where tenant_id = '${T}') as casetas,
  (select count(*) from peaje_tag where tenant_id = '${T}') as tags,
  (select count(*) from viaje_hito_validacion where tenant_id = '${T}') as veredictos,
  (select count(*) from viaje_hito_validacion where tenant_id = '${T}' and resultado = 'validado') as validados,
  (select count(*) from viaje_hito_validacion where tenant_id = '${T}' and resultado = 'sin_coincidencia') as sin_coincidencia,
  (select count(*) from conductor_contacto_trafico where tenant_id = '${T}') as contactos_escalamiento,
  (select count(*) from vigia_contacto where tenant_id = '${T}') as vigia_contactos,
  (select count(*) from vigia_conversacion where tenant_id = '${T}') as vigia_conversaciones,
  (select count(*) from vigia_mensaje where tenant_id = '${T}') as vigia_mensajes,
  (select count(*) from innovativos_sim.convenio) as convenios,
  (select count(*) from innovativos_sim.convenio_instruccion) as instrucciones`);
if (c) {
  hecho('hay datos sembrados (140 viajes en curso ≠ 0)', Number(c.en_curso) > 0 && Number(c.hitos) > 0, 'base sin sembrar');
  dice('140 viajes en curso', `${c.en_curso} viajes en curso`);
  dice('266 cerrados', `${c.cerrados} cerrados`, kit);
  dice('250 tractos', `Tractos (unidad) | ${c.tractos}`, kit);
  dice('terminales', `Terminales | ${c.terminales}`, kit);
  dice('operadores', `Operadores | ${c.operadores}`, kit);
  dice('clientes', `Clientes | ${c.clientes}`, kit);
  dice('geocercas', `Geocercas | ${c.geocercas}`, kit);
  dice('hitos', `Hitos del conductor | ${miles(c.hitos)}`, kit);
  dice('posiciones', `Posiciones GPS | ${miles(c.posiciones)}`, kit);
  dice('casetas / TAG', `Casetas / TAG | ${c.casetas} / ${c.tags}`, kit);
  dice('veredictos', `Veredictos de ubicación | ${c.veredictos}`, kit);
  dice('veredictos: validados y sin coincidencia', `${c.validados} validados, ${c.sin_coincidencia} sin coincidencia`, kit);
  dice('veredictos (guion)', `${c.veredictos} veredictos`, guion);
  dice('escalamiento', `${c.contactos_escalamiento} contactos de escalamiento`, guion);
  dice('Vigía', `Vigía | ${c.vigia_contactos} contactos críticos, ${c.vigia_conversaciones} conversaciones, ${c.vigia_mensajes} mensajes`, kit);
  dice('convenios', `Convenios | ${c.convenios} con ${c.instrucciones} instrucciones`, kit);
  dice('convenios (guion)', `${c.convenios} convenios con ${c.instrucciones} instrucciones`, guion);
}

// ── 2. Todo folio y tracto que citan los documentos existe ─────────────────
const folios = [...new Set(ambos.match(/\bINN-\d{5}\b/g) ?? [])];
const tractos = [...new Set(ambos.match(/\bIN-\d{3}\b/g) ?? [])];
hecho('los documentos citan folios (si no, esta verificación no verifica nada)', folios.length > 0 && tractos.length > 0, `${folios.length} folios, ${tractos.length} tractos`);
if (folios.length) {
  const ex = new Set(consulta(`select folio from viaje where tenant_id = '${T}' and folio in (${folios.map((f) => `'${f}'`).join(',')})`).map((r) => r.folio));
  hecho(`los ${folios.length} folios citados existen como viaje`, folios.every((f) => ex.has(f)), `faltan: ${folios.filter((f) => !ex.has(f)).join(', ')}`);
}
if (tractos.length) {
  const ex = new Set(consulta(`select numero_economico from unidad where tenant_id = '${T}' and numero_economico in (${tractos.map((f) => `'${f}'`).join(',')})`).map((r) => r.numero_economico));
  hecho(`los ${tractos.length} tractos citados existen`, tractos.every((f) => ex.has(f)), `faltan: ${tractos.filter((f) => !ex.has(f)).join(', ')}`);
}
const claves = [...new Set(ambos.match(/\bSAP-LIQ-DEMO-\d{4}-\d{6}\b/g) ?? [])];
if (claves.length) {
  const ex = new Set(consulta(`select clave_externa from liquidacion_externa where tenant_id = '${T}' and clave_externa in (${claves.map((f) => `'${f}'`).join(',')})`).map((r) => r.clave_externa));
  hecho(`las ${claves.length} claves de liquidación citadas existen`, claves.every((f) => ex.has(f)), `faltan: ${claves.filter((f) => !ex.has(f)).join(', ')}`);
}

// ── 3. «Ya llegué» sin GPS: los folios, el veredicto y las distancias salen de la base ──
const llegue = consulta(`select v.folio, vv.distancia_m, vv.fuente, h.estado, h.fuente as fuente_hito
  from viaje_hito_validacion vv join viaje v on v.id = vv.viaje_id and v.tenant_id = vv.tenant_id
  join viaje_hito h on h.id = vv.viaje_hito_id and h.tenant_id = vv.tenant_id
  where vv.tenant_id = '${T}' and vv.resultado = 'sin_coincidencia' order by v.folio`);
hecho('hay 6 veredictos «sin coincidencia»', llegue.length === 6, `hay ${llegue.length}`);
if (llegue.length) {
  hecho('todos son hitos recibidos (no validados), por texto, comparados contra el GPS', llegue.every((r) => r.estado === 'recibido' && r.fuente_hito === 'texto' && r.fuente === 'gps'));
  hecho('los documentos citan los 6 folios del «ya llegué» sin GPS', llegue.every((r) => guion.includes(r.folio) && kit.includes(r.folio)), llegue.map((r) => r.folio).join(', '));
  const kms = llegue.map((r) => Number(r.distancia_m) / 1000);
  const rango = `${Math.round(Math.min(...kms))}–${Math.round(Math.max(...kms))} km`;
  dice(`distancias del «ya llegué» (${rango})`, rango);
  hecho('todas están a más de 20 km de la planta (lejos de verdad)', Math.min(...kms) > 20, `mínima ${Math.min(...kms).toFixed(1)} km`);
}

// ── 4. Sin señal de vida: folios, nivel y antigüedad del último GPS ─────────
const silencio = consulta(`select v.folio, h.escalacion_nivel as nivel,
    extract(epoch from (current_setting('inn.ancla', true)::timestamptz - (select max(p.medida_en) from posicion p where p.tenant_id = v.tenant_id and p.unidad_id = v.unidad_id))) / 60 as min_sin_gps
  from viaje_hito h join viaje v on v.id = h.viaje_id and v.tenant_id = h.tenant_id
  where h.tenant_id = '${T}' and h.estado = 'escalado' order by v.folio`.replace("current_setting('inn.ancla', true)::timestamptz", "(select valor::timestamptz from innovativos_sim.meta where clave = 'ancla')"));
hecho('hay 6 hitos escalados', silencio.length === 6, `hay ${silencio.length}`);
if (silencio.length) {
  hecho('los 6 llevan >100 min sin GPS', silencio.every((r) => Number(r.min_sin_gps) >= 100), silencio.map((r) => `${r.folio}:${Math.round(r.min_sin_gps)}`).join(' '));
  hecho('los documentos citan los 6 folios sin señal de vida', silencio.every((r) => guion.includes(r.folio) && kit.includes(r.folio)));
  const n2 = silencio.filter((r) => Number(r.nivel) === 2).map((r) => r.folio);
  const cita = /((?:INN-\d{5}, )*INN-\d{5} y INN-\d{5}) van a nivel 2/.exec(guion);
  const citados = cita ? cita[1].replace(/ y /g, ', ').split(', ') : [];
  hecho('los folios que el guion manda a nivel 2 son exactamente los de nivel 2 en la base', cita !== null && JSON.stringify([...citados].sort()) === JSON.stringify([...n2].sort()), `guion: ${citados.join(',') || '—'} · base: ${n2.join(',')}`);
  dice('3 a nivel 1, 3 a nivel 2', `${silencio.filter((r) => Number(r.nivel) === 1).length} a nivel 1, ${n2.length} a nivel 2`, kit);
}

// ── 5. Peajes ───────────────────────────────────────────────────────────────
const p = uno('peajes', `select count(*) as total,
  count(*) filter (where detalle ->> 'origen_demo' = 'fuera_de_ruta') as fuera, count(*) filter (where detalle ->> 'origen_demo' = 'duplicado') as dup,
  count(*) filter (where gps_veredicto = 'sin_datos') as sin_datos, count(*) filter (where gps_veredicto = 'no_coincide') as no_coincide
  from desglose_peaje_linea where tenant_id = '${T}'`);
if (p) {
  hecho('hay líneas de pase', Number(p.total) > 0);
  dice('379 cruces', `${p.total} cruces de las últimas 24 h`, guion);
  dice('fuera de ruta', `${p.fuera} cruces fuera de ruta`, guion);
  dice('duplicados', `${p.dup} cobros duplicados`, guion);
  dice('sin dato de GPS', `${p.sin_datos} cruces sin dato de GPS`, guion);
  hecho('los fuera de ruta son los «no coincide» del cruce', Number(p.fuera) === Number(p.no_coincide), `${p.fuera} vs ${p.no_coincide}`);
}
const ej = uno('peaje de ejemplo: INN-24091 / IN-091', `select c.nombre, l.gps_veredicto, to_char(l.cruce_en at time zone 'America/Mexico_City', 'HH24:MI') as hora
  from desglose_peaje_linea l join peaje_caseta c on c.id = l.caseta_id join unidad u on u.id = l.unidad_id and u.tenant_id = l.tenant_id
  where l.tenant_id = '${T}' and u.numero_economico = 'IN-091' and l.detalle ->> 'origen_demo' = 'fuera_de_ruta'`);
if (ej) { hecho('IN-091: cobro fuera de ruta en «Caseta Demo Encarnacion» a las 02:36', ej.nombre === 'Caseta Demo Encarnacion' && ej.hora === '02:36' && ej.gps_veredicto === 'no_coincide', JSON.stringify(ej)); }
const dupl = uno('peaje duplicado: IN-123', `select count(*) as n from desglose_peaje_linea l join unidad u on u.id = l.unidad_id and u.tenant_id = l.tenant_id
  where l.tenant_id = '${T}' and u.numero_economico = 'IN-123' and l.detalle ->> 'origen_demo' = 'duplicado'`);
if (dupl) hecho('IN-123 tiene un cobro duplicado sembrado', Number(dupl.n) >= 1, `${dupl.n} líneas duplicadas`);

// ── 6. Liquidaciones ───────────────────────────────────────────────────────
const l = uno('liquidaciones', `select count(*) as total, count(*) filter (where estado = 'acusada') as acusadas, count(*) filter (where acuse_tipo = 'no_coincide') as no_coincide,
  count(*) filter (where estado = 'enviada') as enviadas, count(*) filter (where estado = 'fallida') as fallidas, count(*) filter (where estado in ('pendiente', 'en_cola')) as pendientes
  from liquidacion_externa where tenant_id = '${T}'`);
if (l) {
  hecho('ninguna liquidación sembrada está pendiente (nada sale de verdad)', Number(l.pendientes) === 0);
  dice('158 liquidaciones', `${l.total} liquidaciones «de su sistema»`, guion);
  dice('estados de las liquidaciones', `${l.acusadas} acusadas (${l.no_coincide} con «No coincide»), ${l.enviadas} enviadas, ${l.fallidas} fallidas`);
  dice('las 8 fallidas son «plantilla aún no aprobada»', `Las ${l.fallidas} «fallidas» sembradas`, guion);
}

// ── 7. Carta Porte: conteos y el detector REAL sobre el archivo de muestra ──
const cp = uno('carta porte', `select count(*) as total, count(*) filter (where estado = 'aprobado') as aprobados, count(*) filter (where estado = 'por_revisar') as por_revisar,
  count(*) filter (where estado = 'rechazado') as rechazados, (select count(*) from cp_perfil where tenant_id = '${T}') as perfiles from cp_documento where tenant_id = '${T}'`);
if (cp) {
  dice('12 documentos', `${cp.total} documentos de 3 clientes ficticios`, guion);
  dice('estados de Carta Porte', `${cp.aprobados} aprobados, ${cp.por_revisar} por revisar, ${cp.rechazados} rechazado`, guion);
  dice('perfiles', `${cp.perfiles} perfiles`, guion);
}
const { createJiti } = createRequire(import.meta.url)('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@': join(raiz, 'src') }, moduleCache: false });
const { detectarInyeccion } = await jiti.import(join(raiz, 'src/lib/likida/carta_porte_docs/inyeccion.ts'));
const malo = leer('scripts/demo/innovativos/archivos-muestra/carta_porte/orden_c12_4_PRUEBA_INYECCION.csv');
const bueno = leer('scripts/demo/innovativos/archivos-muestra/carta_porte/orden_c12_1.csv');
hecho('el detector REAL marca el archivo de muestra con instrucciones escondidas', detectarInyeccion(malo).riesgo === true, JSON.stringify(detectarInyeccion(malo)));
hecho('…y NO marca el documento normal', detectarInyeccion(bueno).riesgo === false, JSON.stringify(detectarInyeccion(bueno)));

// ── 8. Vigía ────────────────────────────────────────────────────────────────
const v = consulta(`select cl.nombre, round(extract(epoch from ((select valor::timestamptz from innovativos_sim.meta where clave = 'ancla') - vc.sin_respuesta_desde)) / 60) as min_sin_resp,
    vc.molestia_nivel, vc.escalamiento_nivel from vigia_conversacion vc join cliente cl on cl.id = vc.cliente_id and cl.tenant_id = vc.tenant_id where vc.tenant_id = '${T}' order by cl.nombre`);
hecho('hay 3 conversaciones de Vigía', v.length === 3, `hay ${v.length}`);
const auto = v.find((r) => r.nombre === 'Autopartes Ficticias del Bajío');
const arma = v.find((r) => r.nombre === 'Armadora Ficticia Ramos Arizpe');
hecho('Autopartes: 14 min sin respuesta (el guion dice 14 min, SLA 10)', !!auto && Number(auto.min_sin_resp) === 14 && guion.includes('14 min sin respuesta'), JSON.stringify(auto));
hecho('Armadora: molesta y en nivel 2', !!arma && Number(arma.molestia_nivel) > 0 && Number(arma.escalamiento_nivel) === 2, JSON.stringify(arma));
const borr = uno('borrador pendiente de aprobación', `select count(*) as n from vigia_mensaje where tenant_id = '${T}' and estado = 'pendiente_aprobacion'`);
if (borr) hecho('hay exactamente un borrador pendiente de aprobación', Number(borr.n) === 1, `hay ${borr.n}`);

// ── 9. Geocercas de muestra: «4 de 17 son polígonos» sale del archivo ───────
const filas = readFileSync(join(aqui, 'archivos-muestra/gps/geocercas.csv'), 'utf8').trim().split('\n');
const enc = filas[0].split(',');
const iTipo = enc.indexOf('tipo');
const datos = filas.slice(1).filter(Boolean);
const poligonos = datos.filter((f) => f.split(',')[iTipo] === 'poligono').length;
hecho('el archivo de geocercas de muestra tiene filas (si no, no verifica nada)', iTipo >= 0 && datos.length > 0, `${datos.length} filas`);
dice(`${poligonos} de ${datos.length} son polígonos`, `${poligonos} de ${datos.length} son polígonos`, guion);

console.log(comprobados === 0 ? '\nFALLA: no se comprobó nada.' : fallas.length === 0 ? `\nOK: los ${comprobados} hechos del guion coinciden con la base.` : `\nFALLA: ${fallas.length} de ${comprobados} hechos no coinciden:\n  - ${fallas.join('\n  - ')}`);
process.exit(comprobados > 0 && fallas.length === 0 ? 0 : 1);
