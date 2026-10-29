// Arma LINEA-BASE-v2.1.md a partir de medidas-<etiqueta>.json: «de X a 0» por criterio y por pantalla, y la comparación con
// los números de PLAN-EJECUCION §4.1 (medidos con el detector v2). Uso: node linea-base.mjs [medidas.json] [salida.md]
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { CRITERIOS } from './informe.mjs';

const dir = path.join(homedir(), 'likida-loop/frontend-plan/rovaq-method');
const entrada = process.argv[2] ?? path.join(dir, 'medidas-v2.1-base.json');
const salida = process.argv[3] ?? path.join(dir, 'LINEA-BASE-v2.1.md');
const S = JSON.parse(readFileSync(entrada, 'utf8'));
// PLAN §4.1: [hallazgos, pantallas]; null = criterio nuevo (sin cifra en §4.1)
const P41 = { 'c1.boton_gordo': [56, 8], 'c1.alto_visual': [68, 4], 'c1.toque': [2984, 25], 'c1.vecinos': [0, 0], 'c2.h1': [128, 16], 'c2.kpi_no_26': [48, 3], 'c2.kpi_mayor_30': [0, 0], 'c2.fuera_de_escala': [3506, 23], 'c2.texto_menor_11': [0, 0], 'c3.radio': [800, 2], 'c3.padding_tarjeta': [856, 22], 'c3.gap': [336, 11], 'c3.padding_pagina': [122, 25], 'c4.hueco_fila': [4, 1], 'c4.aire_inferior': [266, 16], 'c4.min_height_decorativo': [108, 7], 'c4.alto_desigual': [0, 0], 'c5.kpi': [12, 6], 'c5.grafica': [18, 9], 'c5.filas': [14, 7], 'c6.recorte': [2, 1], 'c6.solape': [8, 1], 'c6.desborde': [0, 0], 'c6.sin_nombre': [0, 0], 'c7.gris_sobre_gris': [106, 10], 'c7.contraste': [0, 0], 'c8.un_logo': [8, 1], 'c8.capa_completa': [8, 1], 'c8.solo_la_capa': [8, 1], 'c8.sin_texto': [0, 0], 'c8.un_color': [0, 0] };
const ids = Object.keys(S.pantallas);
const claves = Object.keys(CRITERIOS);
const tot = {}, pant = {};
for (const k of claves) { tot[k] = 0; pant[k] = new Set(); }
for (const id of ids) for (const c of Object.values(S.pantallas[id].combinaciones)) for (const [k, n] of Object.entries(c.n)) { tot[k] = (tot[k] || 0) + n; (pant[k] = pant[k] || new Set()).add(id); }
const L = [];
const suma = Object.values(tot).reduce((a, b) => a + b, 0);
const glob = Object.entries(S.global ?? {});
L.push(`# LÍNEA BASE v2.1 · Likida v2 sobre master (detector v2.1)`, '', `Medida: ${S.meta.fecha}. Detector v2.1 (\`scripts/ui2-calidad\`, rama \`ui2/arnes\`), fixtures creíbles (\`scripts/ui2-captura/fixtures/logistica_mx.ts\`), ${ids.length} pantallas × ${S.meta.anchos.join('/')} × ${S.meta.temas.join('/')} (+ pasada extra 1280×720 claro solo para N3). Datos crudos: \`medidas-v2.1-base.json\` y \`medidas-v2.1-base/<pantalla>.json\` (uno por ruta). Capturas: \`capturas-v2.1-base/\`.`, '', `**Total: ${suma} hallazgos** (suma de elementos en falta en todas las combinaciones; un defecto repetido en 8 combinaciones cuenta 8 veces) → **meta 0**. Globales aparte: ${glob.map(([k, g]) => `\`${k}\` = ${g.n}`).join(', ') || '—'}.`, '');
L.push('## 1. Por criterio: de X a 0, y contra §4.1', '', '| Criterio | Norma | De (v2.1) | A | Pantallas | §4.1 (hallazgos / pantallas) | ¿Difiere? |', '|---|---|---:|---:|---:|---|---|');
const difieren = [];
for (const k of claves) {
  const n = tot[k] || 0, p = pant[k]?.size || 0, b = P41[k];
  const dif = b ? (b[0] !== n || b[1] !== p) : null;
  if (dif) difieren.push([k, b, n, p]);
  L.push(`| \`${k}\` | ${CRITERIOS[k][1]} | ${n} | 0 | ${p} | ${b ? `${b[0]} / ${b[1]}` : 'criterio nuevo'} | ${b ? (dif ? '**sí**' : 'no') : 'n/a'} |`);
}
L.push('', '### Criterios de §4.1 que DIFIEREN de la base v2.1', '', '| Criterio | §4.1 | v2.1 | Causa |', '|---|---|---|---|');
const causa = { 'c3.radio': 'marcas de gráfica exentas (celdas de calor, columnas) y la paleta de datos', 'c1.toque': 'fixtures nuevos (tablas más largas ⇒ más enlaces «Revisar»/«Ver»)', 'c2.fuera_de_escala': 'A2 ahora se mide con datos (antes «No se pudo leer»: +1,674 en A2) y tablas de 12–24 filas con los mismos 12.5 px', 'c5.kpi': 'c5 por tipo de pantalla: asistentes y formularios ya no se juzgan en KPI; sí se juzgan los hubs/listas y el resumen del muestrario', 'c5.grafica': 'c5 por tipo: lista/formulario/asistente ya no exigen gráfica; resumen y hub exigen plot ≥ 140', 'c5.filas': 'tabla ≥ 10 filas en hub/lista y ≥ 8 campos en formulario/asistente (antes ≥ 8 filas solo en «panel»)', 'c6.recorte': 'A2 con datos reales de fixture: nombres de caseta largos truncados con «…» (c6.recorte 50 en A2)', 'c3.cabecera_tabla': 'criterio nuevo (cabecera 36)' };
for (const [k, b, n, p] of difieren) L.push(`| \`${k}\` | ${b[0]} / ${b[1]} | ${n} / ${p} | ${causa[k] ?? 'fixtures nuevos o criterio ajustado'} |`);
L.push('', '## 2. Por pantalla: de X a 0 (suma de las 8 combinaciones + 1280×720 para N3)', '');
const fam = (k) => CRITERIOS[k][0].split(' ')[0];
const familias = [...new Set(claves.map(fam))];
L.push(`| Pantalla | Ruta | Tipo | ${familias.join(' | ')} | Total |`, `|---|---|---|${familias.map(() => '---:').join('|')}|---:|`);
for (const id of ids) {
  const f = Object.fromEntries(familias.map((x) => [x, 0]));
  for (const c of Object.values(S.pantallas[id].combinaciones)) for (const [k, n] of Object.entries(c.n)) if (CRITERIOS[k]) f[fam(k)] += n;
  const m = S.meta.pantallas.find((p) => p.id === id);
  L.push(`| ${id} | ${m?.ruta ?? ''} | ${S.pantallas[id].tipo} | ${familias.map((x) => f[x]).join(' | ')} | ${Object.values(f).reduce((a, b) => a + b, 0)} |`);
}
L.push('', '## 3. Por pantalla y criterio (solo celdas > 0; suma de combinaciones)', '');
for (const id of ids) {
  const acc = {};
  for (const c of Object.values(S.pantallas[id].combinaciones)) for (const [k, n] of Object.entries(c.n)) acc[k] = (acc[k] || 0) + n;
  const ks = Object.keys(acc).filter((k) => acc[k] > 0).sort();
  L.push(`- **${id}** (${S.pantallas[id].tipo}): ${ks.length ? ks.map((k) => `\`${k}\` ${acc[k]}`).join(' · ') : '0'}`);
}
L.push('', '## 4. Números de los criterios N (PLAN §4.2) frente a lo que el plan suponía', '');
const get = (id, c, f) => S.pantallas[id]?.combinaciones?.[c]?.stats?.[f];
const pies = new Set(ids.map((id) => get(id, '1440/claro', 'pie')?.alto).filter(Boolean));
const cats = new Set(ids.map((id) => get(id, '1440/claro', 'categoriasAbiertas')).filter((x) => x !== undefined));
L.push(`- N1: primarios por pliegue >1 en ${pant['n1.primarios']?.size || 0} pantallas; bloque negro/blanco de navegación (ítem activo) en ${pant['n1.masa_nav']?.size || 0} pantallas (el plan suponía «3 masas negras» en el Resumen).`);
L.push(`- N2: mono fuera de IDs/captions: ${tot['n2.mono'] || 0} hallazgos en ${pant['n2.mono']?.size || 0} pantallas; Resumen c01 = ${Object.entries(S.pantallas['c01-resumen-vacio'].combinaciones).filter(([c]) => c === '1440/claro').map(([, v]) => v.n['n2.mono'] || 0)} en 1440/claro (plan: ≥9 sitios).`);
L.push(`- N3: alto del pie del sidebar a 1440×900 = ${[...pies].join(', ')} px (plan: ≈160); recortes a 1440×900/1280×720: ${tot['n3.recorte'] || 0} (plan: «Puesta en marcha» recortada).`);
L.push(`- N4: categorías abiertas del sidebar = ${[...cats].join(', ')} (plan: 3); variantes de sidebar entre pantallas = ${(S.global?.['n4.variantes_sidebar']?.n ?? '—') + 1} (plan: 2).`);
L.push(`- N5: logo SVG ausente/≠1 en ${pant['n5.logo']?.size || 0} de ${ids.length} pantallas (plan: ausente).`);
L.push(`- N6: «0» falso en ${pant['n6.falso_cero']?.size || 0} pantalla(s), ${tot['n6.falso_cero'] || 0} hallazgos (plan: 1 caso conocido «$0.00 Revisar»; ese caso era del fixture viejo y ya no existe; los hallazgos actuales son KPI con 0 real sin fuente+periodo).`);
L.push(`- N7: fixtures ${tot['n7.fixture'] || 0} hallazgos (plan: folios repetidos y «Operador Uno»; con los fixtures nuevos, 0).`);
L.push(`- N8: esqueletos ${tot['n8.esqueleto'] || 0} (en 07-estados) y chips «Observado» repetidos ${tot['n8.observado'] || 0}.`);
L.push(`- c9 (movimiento): CSS de \`ui-v2/\` = ${S.global?.['c9.duracion_css']?.n ?? '—'} duraciones fuera de tokens; \`style=""\` de los componentes v1 dentro de v2 = ${tot['c9.duracion'] || 0} (barras/líneas de gráficas v1 con 350–900 ms: las reemplaza el Carril B).`);
L.push('', '## 5. Límites', '', '- HTML estático (sin JS, hover, overlays ni red): la carga por fotograma con latencia simulada (N9), tooltips (N12), overlays (N11) e invariancia v1 (N13) NO se miden aquí; corresponden a Carril A/B y a CI.', '- A3 (Carta Porte) se mide con la lista de viajes vacía: construir `ViajeCcp` completos exige correr el motor de reglas; el criterio c5.filas de A3 refleja esa limitación del fixture, no solo el diseño.', '- «Sus reglas» de A1 se renderiza con `politica = null` (estado «No se pudo leer»): conviene un fixture de política en el carril de A1.', '- Las 26 pantallas son las del arnés, no las ~140 rutas.');
writeFileSync(salida, L.join('\n') + '\n');
console.log(`escrito ${salida}: ${suma} hallazgos; ${difieren.length} criterios de §4.1 difieren`);
