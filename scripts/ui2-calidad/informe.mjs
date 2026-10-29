// Informe legible a partir de medidas.json (lo usa detectar.mjs).
export const CRITERIOS = {
  'c1.boton_gordo': ['c1 Controles', 'botón > 36 px visuales (primario sólido > 32)'],
  'c1.alto_visual': ['c1 Controles', 'select/input/chip/tab > 36 px visuales'],
  'c1.toque': ['c1 Controles', 'zona táctil < 44 px (prueba de impacto)'],
  'c1.vecinos': ['c1 Controles', 'botones vecinos a < 8 px'],
  'c2.texto_menor_11': ['c2 Tipografía', 'texto < 11 px'],
  'c2.h1': ['c2 Tipografía', 'H1 ≠ 20 px o ≠ 1 por pantalla'],
  'c2.kpi_mayor_30': ['c2 Tipografía', 'cifra KPI > 30 px'],
  'c2.kpi_no_26': ['c2 Tipografía', 'cifra KPI ≠ 26 px'],
  'c2.fuera_de_escala': ['c2 Tipografía', 'tamaño fuera de la escala {11 MAYÚSC., 12, 13, 14, 15, 20, 26}'],
  'c3.radio': ['c3 Padding/gap/radios', 'radio fuera de {8, 12, píldora}'],
  'c3.padding_tarjeta': ['c3 Padding/gap/radios', 'padding de tarjeta > 14 (móvil > 12)'],
  'c3.gap': ['c3 Padding/gap/radios', 'gap > 12'],
  'c3.padding_pagina': ['c3 Padding/gap/radios', 'padding de página ≠ 24 (≥1024) / > 16 (móvil)'],
  'c3.cabecera_tabla': ['c3 Padding/gap/radios', 'cabecera de tabla ≠ 36 px'],
  'c4.hueco_fila': ['c4 Espacio vacío', 'fila de tarjetas que no llena el ancho (> 12 % libre)'],
  'c4.aire_inferior': ['c4 Espacio vacío', 'aire inferior de tarjeta > 24 px o > 25 % del alto'],
  'c4.min_height_decorativo': ['c4 Espacio vacío', 'min-height que deja aire interior'],
  'c4.alto_desigual': ['c4 Espacio vacío', 'tarjetas vecinas de alto distinto (> 4 px)'],
  'c5.kpi': ['c5 Primer pliegue', 'sin tira de KPI en 1440×900'],
  'c5.grafica': ['c5 Primer pliegue', 'sin gráfica principal en 1440×900'],
  'c5.filas': ['c5 Primer pliegue', 'menos de 8 filas de tabla en 1440×900'],
  'c5.atencion': ['c5 Primer pliegue', '«Requiere tu atención» ausente o con < 3 filas en el pliegue (resumen)'],
  'c6.desborde': ['c6 Choques', 'desborde horizontal'],
  'c6.recorte': ['c6 Choques', 'texto recortado / truncado en botón, cifra, etiqueta'],
  'c6.solape': ['c6 Choques', 'hermanos solapados'],
  'c6.sin_nombre': ['c6 Choques', 'control sin nombre accesible'],
  'c7.contraste': ['c7 Contraste', 'texto < 4.5:1 (grande < 3:1)'],
  'c7.gris_sobre_gris': ['c7 Contraste', 'caja del color de su fondo'],
  'c8.un_logo': ['c8 Carga', 'no hay exactamente 1 logo'],
  'c8.capa_completa': ['c8 Carga', 'sin capa fija al 100 % del viewport'],
  'c8.solo_la_capa': ['c8 Carga', 'shell visible junto a la carga'],
  'c8.sin_texto': ['c8 Carga', 'texto visible durante la carga'],
  'c8.un_color': ['c8 Carga', 'capa que no es de un color opaco'],
  'c9.duracion': ['c9 Movimiento', 'duración fuera de los tokens (en style="" del HTML)'],
  'n1.primarios': ['N1 Primarios', 'más de 1 botón primario en el pliegue'],
  'n1.masa_nav': ['N1 Primarios', 'bloque negro (claro) o blanco (oscuro) de navegación'],
  'n2.mono': ['N2 Mono', 'font-family mono fuera de IDs y captions de sidebar'],
  'n3.alto_pie': ['N3 Pie sidebar', 'pie del sidebar > 150 px'],
  'n3.recorte': ['N3 Pie sidebar', 'ítem del pie recortado (1440×900 y 1280×720)'],
  'n4.categorias_abiertas': ['N4 Categorías', 'más de 1 categoría abierta en el sidebar'],
  'n5.logo': ['N5 Logo', 'logo SVG ≠ 1 instancia en sidebar / cabecera móvil'],
  'n6.falso_cero': ['N6 Cero falso', '«0» donde el dato es desconocido (sin fuente+periodo)'],
  'n7.fixture': ['N7 Fixtures', 'folios repetidos, nombres de caricatura, avisos sintéticos por tarjeta'],
  'n8.esqueleto': ['N8 Esqueletos', 'esqueleto en pantalla'],
  'n8.observado': ['N8 Esqueletos', 'chip «Observado» repetido o dentro de un KPI'],
};

const suma = (o, ks) => ks.reduce((a, k) => a + (o[k] || 0), 0);

export function informe(S) {
  const ids = Object.keys(S.pantallas);
  const claves = Object.keys(CRITERIOS);
  const familias = [...new Set(claves.map((k) => CRITERIOS[k][0]))];
  const L = [];
  const combos = (p) => Object.entries(S.pantallas[p].combinaciones);
  const total = (p, f) => combos(p).reduce((a, [, c]) => a + suma(c.n, claves.filter((k) => CRITERIOS[k][0] === f)), 0);
  L.push(`# Informe de calidad UI (${S.meta.etiqueta})`, '', `Generado ${S.meta.fecha}. ${ids.length} pantallas × anchos ${S.meta.anchos.join('/')} × temas ${S.meta.temas.join('/')}. Cada cifra es un número de ELEMENTOS en falta (la suma de todas las combinaciones salvo que se diga otra cosa).`, '');
  L.push('## Por criterio (suma de todas las pantallas y combinaciones)', '', '| Subcriterio | Norma | Hallazgos | Pantallas afectadas |', '|---|---|---:|---:|');
  for (const k of claves) {
    let n = 0; const afect = new Set();
    for (const p of ids) for (const [, c] of combos(p)) if (c.n[k]) { n += c.n[k]; afect.add(p); }
    L.push(`| \`${k}\` | ${CRITERIOS[k][1]} | ${n} | ${afect.size} |`);
  }
  L.push('', '## Por pantalla y familia de criterio (suma de combinaciones)', '', `| Pantalla | Tipo | ${familias.map((f) => f.split(' ')[0]).join(' | ')} | Total |`, `|---|---|${familias.map(() => '---:').join('|')}|---:|`);
  for (const p of ids) {
    const fs = familias.map((f) => total(p, f)); L.push(`| ${p} | ${S.pantallas[p].tipo} | ${fs.join(' | ')} | ${fs.reduce((a, b) => a + b, 0)} |`);
  }
  for (const comb of ['1440/claro', '390/claro']) {
    if (!S.meta.anchos.includes(Number(comb.split('/')[0])) || !S.meta.temas.includes(comb.split('/')[1])) continue;
    L.push('', `## Detalle en ${comb} (elementos en falta por familia)`, '', `| Pantalla | ${familias.map((f) => f.split(' ')[0]).join(' | ')} |`, `|---|${familias.map(() => '---:').join('|')}|`);
    for (const p of ids) { const c = S.pantallas[p].combinaciones[comb]; if (!c) continue; L.push(`| ${p} | ${familias.map((f) => suma(c.n, claves.filter((k) => CRITERIOS[k][0] === f))).join(' | ')} |`); }
  }
  if (S.global) {
    L.push('', '## Globales (no pertenecen a una sola pantalla)', '', '| Criterio | Hallazgos | Ejemplos |', '|---|---:|---|');
    for (const [k, g] of Object.entries(S.global)) L.push(`| \`${k}\` | ${g.n} | ${g.hallazgos.slice(0, 3).map((x) => x.replace(/\|/g, '/')).join(' · ')} |`);
  }
  L.push('', '## Por ancho (suma de todas las pantallas)', '', `| Ancho/tema | ${familias.map((f) => f.split(' ')[0]).join(' | ')} | Total |`, `|---|${familias.map(() => '---:').join('|')}|---:|`);
  for (const w of S.meta.anchos) for (const t of S.meta.temas) {
    const key = `${w}/${t}`; const fs = familias.map((f) => ids.reduce((a, p) => a + suma(S.pantallas[p].combinaciones[key]?.n ?? {}, claves.filter((k) => CRITERIOS[k][0] === f)), 0));
    L.push(`| ${key} | ${fs.join(' | ')} | ${fs.reduce((a, b) => a + b, 0)} |`);
  }
  L.push('', '## Ejemplos (1440/claro, hasta 3 por subcriterio y pantalla)', '');
  for (const p of ids) {
    const c = S.pantallas[p].combinaciones['1440/claro']; if (!c) continue;
    const ks = Object.keys(c.hallazgos); if (!ks.length) continue;
    L.push(`### ${p}`, '');
    for (const k of ks) L.push(`- \`${k}\` (${c.n[k]}): ${c.hallazgos[k].slice(0, 3).map((x) => x.replace(/\|/g, '/')).join(' · ')}`);
    L.push('');
  }
  return L.join('\n');
}
