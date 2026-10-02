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

console.log(`formato de liquidación derivado del Excel de muestra: ${derivado.formato.columnas.length} columnas, ${derivado.formato.datos.length} datos de encabezado; copia a ${COPIA.length} y discrepancia a ${DISCREPANCIA.length} teléfonos 28999…`);
for (const g of leidos) console.log(`histórico del grupo ${g.cli}: ${g.mensajes.length} mensajes leídos por el importador real`);
console.log(`respuestas rápidas aprobadas desde las FAQs del histórico: ${elegidas.length} (${elegidas.map((r) => r.tema).join(', ')})`);
