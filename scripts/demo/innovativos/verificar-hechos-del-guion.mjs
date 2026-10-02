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

const { createJiti } = createRequire(import.meta.url)('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@': join(raiz, 'src') }, moduleCache: false });
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
  (select count(*) from innovativos_sim.convenio_instruccion) as instrucciones,
  (select count(*) from geocerca where tenant_id = '${T}' and poligono is not null) as poligonos,
  (select count(*) from viaje_cruce_geocerca where tenant_id = '${T}') as cruces_geocerca,
  (select count(*) from viaje_senal_vida where tenant_id = '${T}') as senales_de_vida,
  (select count(*) from vigia_grupo where tenant_id = '${T}' and critico) as grupos_criticos,
  (select count(*) from vigia_historial_mensaje where tenant_id = '${T}') as historial_mensajes,
  (select count(*) from vigia_respuesta_rapida where tenant_id = '${T}' and estado = 'aprobada') as respuestas_rapidas,
  (select count(*) from orquestador_escalacion where tenant_id = '${T}' and motivo = 'diferencia_liquidacion') as tareas_diferencia,
  (select count(*) from orquestador_escalacion where tenant_id = '${T}' and motivo = 'diferencia_liquidacion' and estado = 'atendida') as tareas_atendidas`);
if (c) {
  hecho('hay datos sembrados (140 viajes en curso ≠ 0)', Number(c.en_curso) > 0 && Number(c.hitos) > 0, 'base sin sembrar');
  dice('140 viajes en curso', `${c.en_curso} viajes en curso`);
  dice('geocercas poligonales (kit)', `${c.poligonos} con polígono nativo`, kit);
  dice('geocercas poligonales (guion)', `${c.poligonos} de ellas poligonales`, guion);
  dice('cruces de geocerca', `Cruces de geocerca | ${c.cruces_geocerca}`, kit);
  dice('señal de vida', `Señal de vida | ${c.senales_de_vida} episodios`, kit);
  dice('grupos críticos e histórico', `Grupos críticos e histórico | ${c.grupos_criticos} grupos, ${miles(c.historial_mensajes)} mensajes`, kit);
  dice('respuestas rápidas (kit)', `${c.respuestas_rapidas} respuestas rápidas aprobadas`, kit);
  dice('respuestas rápidas (guion)', `${c.respuestas_rapidas} respuestas rápidas aprobadas`, guion);
  dice('tareas de diferencia (kit)', `${c.tareas_diferencia}: ${c.tareas_atendidas} atendidas, ${Number(c.tareas_diferencia) - Number(c.tareas_atendidas)} abiertas`, kit);
  dice('tareas de diferencia (guion)', `${c.tareas_atendidas} ya atendidas y ${Number(c.tareas_diferencia) - Number(c.tareas_atendidas)} abiertas`, guion);
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

// ── 3b. El GPS lo detectó y el chofer no escribió: viajes, fuente, y su fila de cruce ──────────────────────
const porGeocerca = consulta(`select v.folio, count(*) as hitos, count(*) filter (where h.estado = 'validado' and h.validado_por = 'gps' and h.texto_chofer is null and h.lat is null and h.wa_message_id is null) as limpios,
    count(*) filter (where exists (select 1 from viaje_cruce_geocerca x where x.viaje_id = h.viaje_id and x.hito_tipo = h.tipo and x.tenant_id = h.tenant_id and x.completado_en is not null)) as con_cruce
  from viaje_hito h join viaje v on v.id = h.viaje_id and v.tenant_id = h.tenant_id where h.tenant_id = '${T}' and h.fuente = 'sistema' group by v.folio order by v.folio`);
hecho('hay 7 viajes con hitos detectados por geocerca', porGeocerca.length === 7, `hay ${porGeocerca.length}`);
if (porGeocerca.length) {
  hecho('todos esos hitos son «sistema» validados por GPS, sin texto, sin pin ni mensaje del chofer, y con su fila de cruce', porGeocerca.every((r) => Number(r.hitos) === Number(r.limpios) && Number(r.hitos) === Number(r.con_cruce) && Number(r.hitos) > 0), JSON.stringify(porGeocerca.filter((r) => r.hitos !== r.limpios || r.hitos !== r.con_cruce)));
  hecho('los documentos citan los 7 folios detectados por geocerca', porGeocerca.every((r) => guion.includes(r.folio) && kit.includes(r.folio)), porGeocerca.map((r) => r.folio).join(', '));
  dice('los cruces son de esos viajes', `de ${porGeocerca.length} viajes: la llegada y la salida de carga`, kit);
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

// ── 4b. Episodios de señal de vida: cada folio en el estado que el guion le asigna ──────────────────────────
const episodios = consulta(`select v.folio, s.nivel_enviado as nivel, s.cierre_motivo as cierre, s.respuesta from viaje_senal_vida s join viaje v on v.id = s.viaje_id and v.tenant_id = s.tenant_id
  where s.tenant_id = '${T}' order by v.folio`);
hecho('hay 6 episodios de señal de vida', episodios.length === 6, `hay ${episodios.length}`);
if (episodios.length) {
  const de = (f) => episodios.filter(f).map((r) => r.folio);
  const y = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);
  const e1 = de((r) => Number(r.nivel) === 1 && !r.cierre); const e2 = de((r) => Number(r.nivel) === 2 && !r.cierre);
  const e3 = de((r) => Number(r.nivel) === 3 && !r.cierre); const jefe = de((r) => r.cierre === 'atendido_por_jefe'); const chofer = de((r) => r.cierre === 'respondio');
  hecho('los 6 episodios caen en las 5 formas que el guion cuenta (aviso 1, aviso 2, escalado, atendido por el jefe, respondido)', e1.length === 1 && e2.length === 1 && e3.length === 2 && jefe.length === 1 && chofer.length === 1, JSON.stringify({ e1, e2, e3, jefe, chofer }));
  dice('aviso 1 sin respuesta', `${y(e1)} espera tras el aviso 1`, guion);
  dice('aviso 2 sin respuesta', `${y(e2)} tras el aviso 2`, guion);
  dice('escalados al jefe sin atender', `${y(e3)} ya están escalados al jefe sin atender`, guion);
  dice('atendido por el jefe', `${y(jefe)} lo atendió el jefe`, guion);
  dice('respondido por el chofer', `${y(chofer)} lo cerró el chofer`, guion);
  hecho('el chofer que cerró el episodio contestó «Estoy bien»', episodios.filter((r) => r.cierre === 'respondio').every((r) => r.respuesta === 'estoy_bien'));
}

// ── 5. Peajes ───────────────────────────────────────────────────────────────
const p = uno('peajes', `select count(*) as total,
  count(*) filter (where detalle ->> 'origen_demo' = 'fuera_de_ruta') as fuera, count(*) filter (where detalle ->> 'origen_demo' = 'duplicado') as dup,
  count(*) filter (where gps_veredicto = 'sin_datos' and detalle ->> 'origen_demo' = 'real') as sin_datos, count(*) filter (where gps_veredicto = 'no_coincide') as no_coincide,
  count(*) filter (where detalle ->> 'origen_demo' in ('en_patio', 'junto_al_patio')) as junto_al_patio
  from desglose_peaje_linea where tenant_id = '${T}'`);
if (p) {
  hecho('hay líneas de pase', Number(p.total) > 0);
  dice('379 cruces', `${p.total} cruces de las últimas 24 h`, guion);
  dice('fuera de ruta', `${p.fuera} cruces fuera de ruta`, guion);
  dice('duplicados', `${p.dup} cobros duplicados`, guion);
  dice('sin dato de GPS', `${p.sin_datos} cruces sin dato de GPS`, guion);
  dice('cruces junto al patio', `${p.junto_al_patio} cruces junto al patio alargado de Tlaquepaque`, guion);
  dice('cruces junto al patio (kit)', `${p.junto_al_patio} de tractos sin viaje junto al patio poligonal`, kit);
  hecho('los fuera de ruta son los «no coincide» del cruce', Number(p.fuera) === Number(p.no_coincide), `${p.fuera} vs ${p.no_coincide}`);
}
const ej = uno('peaje de ejemplo: INN-24091 / IN-091', `select c.nombre, l.gps_veredicto, to_char(l.cruce_en at time zone 'America/Mexico_City', 'HH24:MI') as hora
  from desglose_peaje_linea l join peaje_caseta c on c.id = l.caseta_id join unidad u on u.id = l.unidad_id and u.tenant_id = l.tenant_id
  where l.tenant_id = '${T}' and u.numero_economico = 'IN-091' and l.detalle ->> 'origen_demo' = 'fuera_de_ruta'`);
if (ej) { hecho('IN-091: cobro fuera de ruta en «Caseta Demo Encarnacion» a las 02:36', ej.nombre === 'Caseta Demo Encarnacion' && ej.hora === '02:36' && ej.gps_veredicto === 'no_coincide', JSON.stringify(ej)); }
const dupl = uno('peaje duplicado: IN-123', `select count(*) as n from desglose_peaje_linea l join unidad u on u.id = l.unidad_id and u.tenant_id = l.tenant_id
  where l.tenant_id = '${T}' and u.numero_economico = 'IN-123' and l.detalle ->> 'origen_demo' = 'duplicado'`);
if (dupl) hecho('IN-123 tiene un cobro duplicado sembrado', Number(dupl.n) >= 1, `${dupl.n} líneas duplicadas`);

// ── 5b. El reporte de reclamación: la FUNCIÓN REAL sobre las líneas y las zonas sembradas ──────────────────
try {
  const { construirReclamacion } = await jiti.import(join(raiz, 'src/lib/likida/peajes/reclamacion.ts'));
  const filasRecl = consulta(`select l.indice, to_char(l.fecha, 'YYYY-MM-DD') as fecha, to_char(l.hora, 'HH24:MI:SS') as hora, l.caseta, c.nombre as caseta_cat, l.tag, u.numero_economico as unidad, l.monto,
      extract(epoch from l.cruce_en) * 1000 as cruce_ms, l.gps_veredicto, l.gps_distancia_m, c.lat, c.lng, c.radio_m,
      (select coalesce(json_agg(json_build_object('lat', p.lat, 'lng', p.lng, 't', extract(epoch from p.medida_en) * 1000)), '[]'::json) from posicion p
        where p.tenant_id = l.tenant_id and p.unidad_id = l.unidad_id and p.medida_en between l.cruce_en - interval '20 minutes' and l.cruce_en + interval '20 minutes') as muestras
    from desglose_peaje_linea l join peaje_caseta c on c.id = l.caseta_id left join unidad u on u.id = l.unidad_id where l.tenant_id = '${T}' order by l.indice`);
  const zonas = consulta(`select nombre, tipo, lat, lng, radio_m, poligono, aproximada from geocerca where tenant_id = '${T}' and tipo in ('patio', 'restringida')`);
  const veredicto = { confirma: 'confirma', no_coincide: 'no coincide', sin_datos: 'sin datos' };
  const lineasRecl = filasRecl.map((l) => ({ indice: l.indice, fecha: l.fecha, hora: l.hora, caseta: l.caseta, casetaCatalogo: l.caseta_cat, tag: l.tag, unidad: l.unidad ?? '', monto: Number(l.monto), cruceMs: Number(l.cruce_ms),
    gps: veredicto[l.gps_veredicto] ?? 'sin evaluar', gpsDistanciaM: l.gps_distancia_m == null ? null : Number(l.gps_distancia_m), gpsNota: '', casetaGeo: { lat: l.lat, lng: l.lng, radioM: l.radio_m }, muestras: l.muestras }));
  hecho('hay líneas para armar la reclamación', lineasRecl.length > 0, 'sin líneas (¿base sin sembrar?)');
  if (lineasRecl.length > 0) {
    const r = construirReclamacion(lineasRecl, zonas.map((z) => ({ nombre: z.nombre, tipo: z.tipo, lat: z.lat, lng: z.lng, radioM: z.radio_m, poligono: z.poligono, aproximada: z.aproximada })));
    const m = r.resumen.porMotivo;
    const peso = (n) => `$${miles(Math.round(Number(n)))}`;
    dice('reclamación: reclamables y monto', `${r.resumen.reclamables} cruces reclamables por ${peso(r.resumen.montoReclamable)}`, guion);
    dice('reclamación: GPS lejos', `${m.gps_lejos_de_caseta.n} por «GPS lejos de la caseta» (${peso(m.gps_lejos_de_caseta.monto)}, confianza alta)`, guion);
    dice('reclamación: doble cobro', `${m.doble_cobro.n} por «posible doble cobro» (${peso(m.doble_cobro.monto)}, confianza media)`, guion);
    dice('reclamación: zona no autorizada', `${m.unidad_en_zona_no_autorizada.n} por «unidad en zona no autorizada» (${peso(m.unidad_en_zona_no_autorizada.monto)}, confianza alta)`, guion);
    dice('reclamación (kit)', `${r.resumen.reclamables} reclamables por ${peso(r.resumen.montoReclamable)}`, kit);
    const zona = r.cruces.find((c) => c.unidad === 'IN-141');
    hecho('IN-141 se reclama por zona no autorizada, confianza alta, dentro de «Patio Tlaquepaque» (polígono exacto)', !!zona && zona.motivo === 'unidad_en_zona_no_autorizada' && zona.confianza === 'alta' && zona.zona?.nombre === 'Patio Tlaquepaque', JSON.stringify(zona ?? null));
    hecho('IN-142 (carretera de junto, dentro del círculo y fuera del polígono) NO se reclama', !r.cruces.some((c) => c.unidad === 'IN-142') && r.resumen.sinDatos >= 1, `reclamables de IN-142: ${r.cruces.filter((c) => c.unidad === 'IN-142').length}`);
    hecho('las zonas del reporte traen el polígono nativo del patio (no solo un círculo)', zonas.some((z) => z.nombre === 'Patio Tlaquepaque' && Array.isArray(z.poligono) && z.poligono.length >= 3 && z.aproximada === false));
  }
} catch (e) {
  hecho('la función real de reclamación corrió sobre lo sembrado', false, e instanceof Error ? e.message : String(e));
}

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

// ── 6b. Formato de la flota, copia al jefe, discrepancias con su aviso y «Reavisar» ─────────────────────────
const fmt = uno('formato de liquidación de la flota', `select cardinality(copia_telefonos) as copia, cardinality(discrepancia_telefonos) as discrepancia, nombre_muestra,
  (select bool_and(t like '28999%') from unnest(copia_telefonos || discrepancia_telefonos) t) as todos_28999, jsonb_array_length(formato -> 'columnas') as columnas
  from liquidacion_formato_flota where tenant_id = '${T}'`);
if (fmt) {
  dice('copia al jefe y discrepancia (guion)', `con la copia al jefe de flota (${fmt.copia} teléfono) y el aviso de discrepancia (${fmt.discrepancia} teléfonos)`, guion);
  hecho('los teléfonos de copia y de discrepancia llevan la marca 28999', fmt.todos_28999 === true && Number(fmt.copia) >= 1 && Number(fmt.discrepancia) >= 1, JSON.stringify(fmt));
  dice('formato derivado del Excel de muestra', `${fmt.nombre_muestra}`, ambos);
}
const av = uno('avisos de discrepancia', `select count(*) filter (where a.estado = 'enviado') as enviados, count(*) filter (where a.estado = 'fallido') as fallidos, count(*) filter (where a.estado in ('pendiente', 'enviando')) as pendientes,
  (select count(*) from liquidacion_externa where tenant_id = '${T}' and acuse_tipo = 'no_coincide') as discrepancias
  from liquidacion_aviso_discrepancia a where a.tenant_id = '${T}'`);
if (av) {
  hecho('cada «No coincide» tiene su aviso y ninguno queda pendiente', Number(av.enviados) + Number(av.fallidos) === Number(av.discrepancias) && Number(av.pendientes) === 0 && Number(av.discrepancias) > 0, JSON.stringify(av));
  hecho('hay avisos fallidos que muestran «Reavisar» y avisos entregados', Number(av.fallidos) >= 1 && Number(av.enviados) >= 1);
  dice('avisos de discrepancia', `de las ${av.discrepancias} discrepancias, ${av.enviados} muestran «Oficina avisada» y ${av.fallidos} muestran «El aviso no llegó»`, guion);
  dice('avisos de discrepancia (kit)', `${av.discrepancias} (${av.enviados} entregados, ${av.fallidos} fallidos)`, kit);
}

// ── 7. Carta Porte: conteos y el detector REAL sobre el archivo de muestra ──
const cp = uno('carta porte', `select count(*) as total, count(*) filter (where estado = 'aprobado') as aprobados, count(*) filter (where estado = 'por_revisar') as por_revisar,
  count(*) filter (where estado = 'rechazado') as rechazados, count(*) filter (where estado = 'recibido') as recibidos, count(*) filter (where estado = 'fallido') as fallidos, (select count(*) from cp_perfil where tenant_id = '${T}') as perfiles from cp_documento where tenant_id = '${T}'`);
if (cp) {
  dice('14 documentos', `${cp.total} documentos de 3 clientes ficticios`, guion);
  dice('estados de Carta Porte', `${cp.aprobados} aprobados, ${cp.por_revisar} por revisar, ${cp.rechazados} rechazado, ${cp.recibidos} recibido y ${cp.fallidos} fallido`, guion);
  dice('Carta Porte (kit)', `Carta Porte | ${cp.total} documentos, ${cp.perfiles} perfiles`, kit);
  dice('perfiles', `${cp.perfiles} perfiles`, guion);
}
// El worker (0640–0642): las tres huellas que cuenta el guion.
const w = consulta(`select nombre_archivo, estado, intentos, avisos_oficina ? 'hallazgos' as aviso_hallazgos, avisos_oficina ? 'agotado' as aviso_agotado, storage_ruta is null as sin_archivo
  from cp_documento where tenant_id = '${T}' and nombre_archivo in ('orden_c05_3.pdf', 'orden_c05_5.pdf', 'orden_c05_6.pdf') order by nombre_archivo`);
const doc = (n) => w.find((x) => x.nombre_archivo === n);
hecho('orden_c05_3: por revisar y ya avisó a la oficina por sus dudas (una sola vez)', doc('orden_c05_3.pdf')?.estado === 'por_revisar' && doc('orden_c05_3.pdf')?.aviso_hallazgos === true, JSON.stringify(doc('orden_c05_3.pdf') ?? null));
hecho('orden_c05_5: recibido, 0 intentos (el siguiente barrido lo toma)', doc('orden_c05_5.pdf')?.estado === 'recibido' && Number(doc('orden_c05_5.pdf')?.intentos) === 0, JSON.stringify(doc('orden_c05_5.pdf') ?? null));
hecho('orden_c05_6: fallido tras 5 intentos y con el aviso «agotado»', doc('orden_c05_6.pdf')?.estado === 'fallido' && Number(doc('orden_c05_6.pdf')?.intentos) === 5 && doc('orden_c05_6.pdf')?.aviso_agotado === true, JSON.stringify(doc('orden_c05_6.pdf') ?? null));
hecho('ningún documento sembrado tiene archivo en Storage (el worker no llama a un modelo en el demo)', w.length === 3 && w.every((x) => x.sin_archivo === true));
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

// ── 8b. Histórico del Vigía: la tabla del guion sale del análisis REAL sobre lo que guardó el importador ───
try {
  const { analizarHistorial } = await jiti.import(join(raiz, 'src/lib/likida/vigia/historial/analisis.ts'));
  const msgs = consulta(`select g.nombre as grupo, c.nombre as cliente, to_char(m.enviado_en at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as enviado_en, m.rol, m.texto
    from vigia_historial_mensaje m join vigia_grupo g on g.id = m.grupo_id and g.tenant_id = m.tenant_id join cliente c on c.id = g.cliente_id and c.tenant_id = g.tenant_id where m.tenant_id = '${T}' order by m.enviado_en, m.id`);
  hecho('hay histórico del Vigía guardado', msgs.length > 0, 'sin mensajes de histórico (¿sembrar-importadores.mjs?)');
  const etiqueta = { 'Autopartes Ficticias del Bajío': 'Autopartes (iOS)', 'Armadora Ficticia Ramos Arizpe': 'Armadora (Android)', 'Cervecería Ficticia del Norte': 'Cervecería (iOS, .zip)' };
  const nombres = [...new Set(msgs.map((x) => x.cliente))];
  for (const cli of nombres) {
    const a = analizarHistorial(msgs.filter((x) => x.cliente === cli).map((x) => ({ enviadoEn: x.enviado_en, rol: x.rol, texto: x.texto })));
    const quejas = a.porTema.find((t) => t.tema === 'queja')?.mensajes ?? 0;
    dice(`histórico de ${cli}`, `| ${etiqueta[cli] ?? cli} | ${a.mensajes} | ${a.mensajesCliente} | ${a.tiempos.sobreUmbral} | ${a.tiempos.medianaMin} / ${a.tiempos.p90Min} | ${quejas} |`, guion);
  }
  hecho('los 3 grupos del histórico son los 3 clientes críticos', nombres.length === 3, nombres.join(', '));
} catch (e) {
  hecho('el análisis real del histórico corrió sobre lo guardado', false, e instanceof Error ? e.message : String(e));
}

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
