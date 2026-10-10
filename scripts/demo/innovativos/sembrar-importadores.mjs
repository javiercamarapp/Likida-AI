#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Siembra lo que NO se escribe a mano: pasa los archivos de muestra por los importadores REALES del producto y guarda lo
// que ellos producen, igual que si la persona hubiera cargado el archivo en la pantalla.
//
//   · Formato de liquidación de la flota: `derivarFormatoDeMatriz` sobre formato_liquidacion_muestra.xlsx (el mismo
//     lector de Excel del panel), más los teléfonos de la COPIA al jefe de flota y del aviso de DISCREPANCIA, todos con la
//     marca de demo 28999… (tabla liquidacion_formato_flota, 0564/0645).
//   · Vigía: los 3 grupos CRÍTICOS (vigia_grupo, 0484), su histórico exportado (.txt iOS, .txt Android, .zip) leído con
//     `leerExportWhatsapp` + `textoDeZip` (vigia_historial_import / vigia_historial_mensaje) y las respuestas rápidas
//     APROBADAS que salen de las FAQs que calcula `analizarHistorial` (vigia_respuesta_rapida, 0647).
//   · Carta Porte con VARIOS embarques (P13, 0670-0672): el Excel de muestra se lee con el lector del producto (`prepararContenido`), se
//     PARTE con `evaluarDivision`/`derivarHijos`, el original queda `dividido` por la RPC real `cp_documento_dividir` y cada hijo se lee
//     con el perfil del cliente (`aplicarPerfil`, sin modelo) y se valida con `validarExtraccion`, como lo haría el worker.
//
// POR QUÉ ASÍ: el seed no inventa resultados de un importador; si cambia el importador, cambia lo sembrado (y la prueba
// de muestras lo delata). Se corre después de sembrar.sql (lo hace sembrar.sh). IDEMPOTENTE: ids deterministas, upsert
// del formato y borrado + reinserción del histórico del tenant demo.
//
//   DEMO_DATABASE_URL='postgresql:///likida_demo' node scripts/demo/innovativos/sembrar-importadores.mjs
// ═══════════════════════════════════════════════════════════════════════════
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { exigirBaseLocal } from './guarda-host.mjs';

exigirBaseLocal(); // misma guarda que sembrar.sh, antes de abrir ninguna conexión
const T = 'eeeeeeee-0620-4000-8000-000000000250';
const URL_DB = process.env.DEMO_DATABASE_URL;
if (!URL_DB) { console.error('Define DEMO_DATABASE_URL.'); process.exit(2); }
const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..', '..', '..');
const muestras = join(aqui, 'archivos-muestra');
const { createJiti } = createRequire(import.meta.url)('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@': join(raiz, 'src') }, moduleCache: false });
const { matrizDeArchivoCatalogo } = await jiti.import(join(raiz, 'src/lib/likida/peajes/archivo.ts'));
const { derivarFormatoDeMatriz } = await jiti.import(join(raiz, 'src/lib/likida/liquidacion_externa/formato_flota.ts'));
const { leerExportWhatsapp } = await jiti.import(join(raiz, 'src/lib/likida/vigia/historial/export_whatsapp.ts'));
const { textoDeZip } = await jiti.import(join(raiz, 'src/lib/likida/vigia/historial/zip_lector.ts'));
const { analizarHistorial } = await jiti.import(join(raiz, 'src/lib/likida/vigia/historial/analisis.ts'));
const { validarRespuestaRapida } = await jiti.import(join(raiz, 'src/lib/likida/vigia/respuestas_rapidas.ts'));
const { prepararContenido } = await jiti.import(join(raiz, 'src/lib/likida/carta_porte_docs/contenido.ts'));
const { evaluarDivision, derivarHijos } = await jiti.import(join(raiz, 'src/lib/likida/carta_porte_docs/multiembarque.ts'));
const { aplicarPerfil } = await jiti.import(join(raiz, 'src/lib/likida/carta_porte_docs/perfiles.ts'));
const { validarExtraccion, confianzaMinimaCritica } = await jiti.import(join(raiz, 'src/lib/likida/carta_porte_docs/validacion.ts'));
import { NOMBRE_MULTIEMBARQUE } from './muestra-multiembarque.mjs';

const psql = (input) => execFileSync('psql', [URL_DB, '-Atq', '-v', 'ON_ERROR_STOP=1'], { encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 });
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const uid = (k) => `md5('innovativos-demo-0620:${k}')::uuid`;
const ancla = psql("select valor from innovativos_sim.meta where clave = 'ancla'").trim();
if (!ancla) { console.error('FALLA: no hay ancla (innovativos_sim.meta): siembra primero.'); process.exit(2); }

// ── 1. Formato de liquidación de la flota + teléfonos de copia y discrepancia (marca 28999) ─────────────────────
const NOMBRE_MUESTRA = 'formato_liquidacion_muestra.xlsx';
const matriz = matrizDeArchivoCatalogo(NOMBRE_MUESTRA, new Uint8Array(readFileSync(join(muestras, 'liquidacion', NOMBRE_MUESTRA))));
if (!matriz.ok) { console.error(`FALLA: el lector de Excel no abrió la muestra: ${matriz.motivo}`); process.exit(1); }
const derivado = derivarFormatoDeMatriz(matriz.matriz);
if (!derivado.ok) { console.error(`FALLA: el derivador no leyó el formato de la muestra: ${derivado.motivo}`); process.exit(1); }
if (derivado.sinMapear.length > 0) { console.error(`FALLA: encabezados de la muestra sin mapear: ${derivado.sinMapear.join(', ')}`); process.exit(1); }
const COPIA = ['2899950000001'];                       // jefe de flota: recibe copia de cada liquidación entregada
const DISCREPANCIA = ['2899950000002', '2899950000003']; // responsables: reciben el aviso de un «No coincide»
const arr = (a) => `array[${a.map(q).join(',')}]::text[]`;
psql(`insert into liquidacion_formato_flota (tenant_id, formato, nombre_muestra, copia_telefonos, discrepancia_telefonos, actualizado_en, actualizado_por)
values ('${T}', ${q(JSON.stringify(derivado.formato))}::jsonb, ${q(NOMBRE_MUESTRA)}, ${arr(COPIA)}, ${arr(DISCREPANCIA)}, ${q(ancla)}::timestamptz, 'demo')
on conflict (tenant_id) do update set formato = excluded.formato, nombre_muestra = excluded.nombre_muestra, copia_telefonos = excluded.copia_telefonos,
  discrepancia_telefonos = excluded.discrepancia_telefonos, actualizado_en = excluded.actualizado_en, actualizado_por = excluded.actualizado_por;`);

// ── 2. Vigía: grupos críticos + histórico exportado + respuestas rápidas aprobadas ───────────────────────────────
const EQUIPO = ['Despacho Innovativos Demo', 'Servicio a Cliente Demo A', 'Servicio a Cliente Demo B', 'Servicio a Cliente Demo C'];
const GRUPOS = [
  { cli: 'c05', nombre: 'Grupo crítico: Autopartes Ficticias del Bajío (Silao)', archivo: 'grupo_afb_silao_ios.txt' },
  { cli: 'c10', nombre: 'Grupo crítico: Armadora Ficticia Ramos Arizpe', archivo: 'grupo_arr_ramos_android.txt' },
  { cli: 'c12', nombre: 'Grupo crítico: Cervecería Ficticia del Norte (Apodaca)', archivo: 'grupo_cfn_apodaca_ios.zip' },
];
const leidos = GRUPOS.map((g) => {
  const bytes = new Uint8Array(readFileSync(join(muestras, 'whatsapp', g.archivo)));
  let texto;
  if (g.archivo.endsWith('.zip')) {
    const z = textoDeZip(bytes);
    if (!z.ok) { console.error(`FALLA: ${g.archivo}: ${z.error}`); process.exit(1); }
    texto = z.texto;
  } else texto = Buffer.from(bytes).toString('utf8');
  const lectura = leerExportWhatsapp(texto, { equipo: EQUIPO, sal: T });
  if (lectura.mensajes.length === 0) { console.error(`FALLA: el importador no leyó ningún mensaje de ${g.archivo}`); process.exit(1); }
  const ordenados = [...lectura.mensajes].sort((a, b) => (a.enviadoEn < b.enviadoEn ? -1 : 1));
  return { ...g, sha256: createHash('sha256').update(bytes).digest('hex'), mensajes: ordenados };
});

const sql = ['begin;', `delete from vigia_grupo where tenant_id = '${T}' and id in (${GRUPOS.map((g) => uid(`vigiagrupo:${g.cli}`)).join(',')});`]; // cascada: import y mensajes
for (const g of leidos) {
  sql.push(`insert into vigia_grupo (id, tenant_id, cliente_id, nombre, critico, created_at, updated_at)
    values (${uid(`vigiagrupo:${g.cli}`)}, '${T}', ${uid(`cliente:${g.cli}`)}, ${q(g.nombre)}, true, ${q(ancla)}::timestamptz - interval '30 days', ${q(ancla)}::timestamptz - interval '30 days');`);
  sql.push(`insert into vigia_historial_import (id, tenant_id, grupo_id, sha256, mensajes, desde, hasta, created_at)
    values (${uid(`vigiaimport:${g.cli}`)}, '${T}', ${uid(`vigiagrupo:${g.cli}`)}, ${q(g.sha256)}, ${g.mensajes.length}, ${q(g.mensajes[0].enviadoEn)}::timestamptz,
            ${q(g.mensajes[g.mensajes.length - 1].enviadoEn)}::timestamptz, ${q(ancla)}::timestamptz - interval '29 days');`);
  for (let i = 0; i < g.mensajes.length; i += 250) {
    const filas = g.mensajes.slice(i, i + 250).map((m) => `('${T}', ${uid(`vigiaimport:${g.cli}`)}, ${uid(`vigiagrupo:${g.cli}`)}, ${q(m.enviadoEn)}::timestamptz, ${q(m.rol)}, ${q(m.autorHash)}, ${q(m.texto)}, ${q(ancla)}::timestamptz - interval '29 days')`);
    sql.push(`insert into vigia_historial_mensaje (tenant_id, import_id, grupo_id, enviado_en, rol, autor_hash, texto, created_at) values ${filas.join(',')};`);
  }
}

// Respuestas rápidas aprobadas: las FAQs del histórico (todas las del conjunto) con una respuesta típica del equipo, de un
// tema que admite respuesta rápida (las quejas y «quiero hablar con alguien» las atiende una persona).
const reporte = analizarHistorial(leidos.flatMap((g) => g.mensajes));
const TEMAS_BASE = new Set(['ubicacion', 'eta', 'documentos', 'factura_pod', 'cita_anden', 'tarifa', 'otro']); // dominio de la tabla (0647)
const elegidas = [];
const usadas = new Set();
for (const f of reporte.faqs) {
  if (!f.respuestaTipica || f.tema === 'otro' || !TEMAS_BASE.has(f.tema) || usadas.has(f.tema)) continue; // una por tema: lista corta y variada
  // Una respuesta que un gerente aprobaría como «base» no lleva una hora, un folio ni un lugar concretos (eso es del viaje de ese día).
  if (/\d/.test(f.respuestaTipica) || /\b(va por|llega a)\b/i.test(f.respuestaTipica)) continue;
  if (/\bINN-\d+/.test(f.pregunta)) continue; // la pregunta de un viaje concreto no es una pregunta típica
  const v = validarRespuestaRapida({ tema: f.tema, pregunta: f.pregunta, texto: f.respuestaTipica });
  if (!v.ok) continue;
  usadas.add(f.tema); elegidas.push(v.valor);
  if (elegidas.length === 4) break;
}
if (elegidas.length === 0) { console.error('FALLA: el análisis del histórico no dejó ninguna FAQ con respuesta típica: no hay respuestas rápidas que aprobar.'); process.exit(1); }
// Se borran los 10 ids posibles (no solo los que se van a insertar): si el importador cambia y salen menos, no queda una vieja.
sql.push(`delete from vigia_respuesta_rapida where tenant_id = '${T}' and id in (${Array.from({ length: 10 }, (_, i) => uid(`respuestarapida:${i + 1}`)).join(',')});`);
elegidas.forEach((r, i) => {
  sql.push(`insert into vigia_respuesta_rapida (id, tenant_id, tema, pregunta, texto, estado, aprobada_en, usos, created_at, updated_at)
    values (${uid(`respuestarapida:${i + 1}`)}, '${T}', ${q(r.tema)}, ${q(r.pregunta)}, ${q(r.texto)}, 'aprobada', ${q(ancla)}::timestamptz - interval '${i + 1} days', 0,
            ${q(ancla)}::timestamptz - interval '${i + 1} days', ${q(ancla)}::timestamptz - interval '${i + 1} days');`);
});
sql.push('commit;');
psql(sql.join('\n'));

// ── 3. Carta Porte: un Excel con VARIOS embarques partido en hijos (P13) ─────────────────────────────────────────
// El padre nace `procesando` (así lo deja el worker al reclamarlo) y la RPC real lo pasa a `dividido` con sus hijos y su linaje. Cada hijo se lee
// con el perfil del cliente SIN modelo (la siguiente vez del mismo formato) y queda por revisar, con su validación real.
const PERFIL_CLAVE = 'arr-excel-demo';
const bytesExcel = new Uint8Array(readFileSync(join(muestras, 'carta_porte', NOMBRE_MULTIEMBARQUE)));
const mapeos = JSON.parse(psql(`select mapeos::text from cp_perfil_version where tenant_id = '${T}' and perfil_id = ${uid(`cpperfil:${PERFIL_CLAVE}`)} and version = 1`).trim());
const perfil = { id: 'perfil-demo', clave: PERFIL_CLAVE, nombre: 'Armadora (Excel)', clienteId: null, formato: 'excel', firma: { formato: 'excel' }, versionActiva: 1, activa: { version: 1, mapeos, ejemplos: [] } };
const contenidoExcel = await prepararContenido(bytesExcel, 'excel');
const evaluacion = evaluarDivision(contenidoExcel, perfil);
if (!evaluacion.plan) { console.error(`FALLA: el partidor del producto no partió el Excel de muestra de varios embarques (exceso=${evaluacion.exceso}, variasHojas=${JSON.stringify(evaluacion.variasHojas)}).`); process.exit(1); }
const hijosDerivados = derivarHijos(evaluacion.plan, NOMBRE_MULTIEMBARQUE);
const hijosLeidos = [];
for (const h of hijosDerivados) {
  const contenido = await prepararContenido(h.bytes, 'csv');
  const r = aplicarPerfil(perfil, contenido);
  const validacion = validarExtraccion(r.extraccion, { riesgoInyeccion: false, remitenteReconocido: true });
  hijosLeidos.push({ ...h, extraccion: r.extraccion, validacion, confianzaMin: confianzaMinimaCritica(r.extraccion), textoExtracto: Buffer.from(h.bytes).toString('utf8').slice(0, 2000) });
}
const idPadre = uid(`cpdoc:${NOMBRE_MULTIEMBARQUE}`);
const shaPadre = createHash('sha256').update(bytesExcel).digest('hex');
// El id de cada hijo es determinista (igual que `uid` en SQL: md5 → uuid); la RPC lo respeta cuando viene en el hijo.
const uuidJs = (k) => { const x = createHash('md5').update(`innovativos-demo-0620:${k}`).digest('hex'); return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`; };
const idHijo = (h) => `'${uuidJs(`cpdoc:${NOMBRE_MULTIEMBARQUE}:hijo:${h.indice}`)}'::uuid`;
const fecha = "(select valor::timestamptz from innovativos_sim.meta where clave = 'ancla')";
const cp = ['begin;',
  // Idempotente: se rehace el padre y sus hijos desde cero (los hijos primero; la ficha de linaje cae en cascada con cualquiera de los dos).
  `delete from cp_documento where tenant_id = '${T}' and id in (${hijosLeidos.map(idHijo).join(',')});`,
  `delete from cp_documento where tenant_id = '${T}' and id = ${idPadre};`,
  `insert into cp_documento (id, tenant_id, canal, formato, nombre_archivo, mime, bytes, sha256, estado, version, intentos, procesando_hasta, cliente_id, perfil_id, perfil_version,
                            remitente, asunto, remitente_reconocido, modelo, retener_hasta, created_at, updated_at)
   values (${idPadre}, '${T}', 'whatsapp', 'excel', ${q(NOMBRE_MULTIEMBARQUE)}, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ${bytesExcel.length}, ${q(shaPadre)},
           'procesando', 2, 1, ${fecha} + interval '2 minutes', ${uid('cliente:c10')}, ${uid(`cpperfil:${PERFIL_CLAVE}`)}, 1,
           'logistica@c10.demo.invalid', 'Plan de embarques del día', true, 'demo-sintetico', ${fecha} + interval '180 days', ${fecha} - interval '3 hours', ${fecha} - interval '3 hours');`,
  `select count(*) from cp_documento_dividir('${T}', ${idPadre}, 2, ${q(JSON.stringify(hijosLeidos.map((h) => ({ id: uuidJs(`cpdoc:${NOMBRE_MULTIEMBARQUE}:hijo:${h.indice}`), indice: h.indice, clave: h.clave, nombre: h.nombre, sha256: h.sha256, bytes: h.bytes.length, storage_ruta: null }))))}::jsonb,
         ${fecha} + interval '180 days', ${fecha} + interval '180 days');`,
];
for (const h of hijosLeidos) {
  cp.push(`update cp_documento set estado = 'por_revisar', version = 2, perfil_id = ${uid(`cpperfil:${PERFIL_CLAVE}`)}, perfil_version = 1, texto_extracto = ${q(h.textoExtracto)},
           extraccion = ${q(JSON.stringify(h.extraccion))}::jsonb, validacion = ${q(JSON.stringify(h.validacion))}::jsonb, confianza_min = ${h.confianzaMin ?? 'null'}, nivel_modelo = 1, modelo = 'demo-sintetico',
           abierto_en = ${fecha} - interval '2 hours', created_at = ${fecha} - interval '3 hours', updated_at = ${fecha} - interval '2 hours', remitente = 'logistica@c10.demo.invalid', asunto = 'Plan de embarques del día'
         where tenant_id = '${T}' and id = ${idHijo(h)};`);
}
cp.push(`update cp_documento set modelo = 'demo-sintetico', updated_at = ${fecha} - interval '3 hours' where tenant_id = '${T}' and id = ${idPadre};`, 'commit;');
psql(cp.join('\n'));

console.log(`formato de liquidación derivado del Excel de muestra: ${derivado.formato.columnas.length} columnas, ${derivado.formato.datos.length} datos de encabezado; copia a ${COPIA.length} y discrepancia a ${DISCREPANCIA.length} teléfonos 28999…`);
for (const g of leidos) console.log(`histórico del grupo ${g.cli}: ${g.mensajes.length} mensajes leídos por el importador real`);
console.log(`respuestas rápidas aprobadas desde las FAQs del histórico: ${elegidas.length} (${elegidas.map((r) => r.tema).join(', ')})`);
console.log(`Carta Porte con varios embarques (P13): ${NOMBRE_MULTIEMBARQUE} partido por el producto en ${hijosLeidos.length} hijos (${hijosLeidos.map((h) => `${h.clave}: ${h.filas} fila${h.filas === 1 ? '' : 's'}`).join('; ')}); cada uno leído con el perfil del cliente`);
