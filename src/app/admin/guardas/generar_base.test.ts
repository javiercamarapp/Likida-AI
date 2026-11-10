/* eslint-disable security/detect-non-literal-fs-filename -- escribe la base en el propio repo */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { SRC, direccionesEstaticas, medirEmojis, medirEncabezados, medirPestanas } from './medir';
import { entradaDeRuta } from '../rutas';

// Regenerar la base (solo para BAJARLA, nunca para subirla):  GENERAR_BASE_GUARDAS_ADMIN=1 npx vitest run src/app/admin/guardas/generar_base.test.ts
const obj = (r: Record<string, number>) => Object.keys(r).length === 0 ? '{}' : `{\n${Object.entries(r).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `  '${k}': ${v},`).join('\n')}\n}`;
const lista = (l: string[]) => `[\n${l.map((x) => `  '${x}',`).join('\n')}\n]`;

it.runIf(process.env.GENERAR_BASE_GUARDAS_ADMIN)('escribe base.ts con lo medido hoy', () => {
  const e = medirEncabezados();
  const fueraDelMenu = direccionesEstaticas().filter((d) => entradaDeRuta(d) === null);
  writeFileSync(join(SRC, 'app/admin/guardas/base.ts'), `// Líneas base MEDIDAS de las guardas de /admin (Fase 0, K3). Solo pueden BAJAR: al arreglar un archivo se borra o se reduce su línea.
// Regenerar para bajar: GENERAR_BASE_GUARDAS_ADMIN=1 npx vitest run src/app/admin/guardas/generar_base.test.ts

/** una_barra_de_pestanas: barras de pestañas propias fuera de la automática (pestanas-admin.tsx). */
export const BASE_PESTANAS_PROPIAS: Record<string, number> = ${obj(medirPestanas())};

/** admin_encabezados_contrato: un MarcoPagina por pantalla, sin BarraPagina, sin h1 propio, apoyo <= 140. */
export const BASE_BARRA_PAGINA: Record<string, number> = ${obj(e.barra)};
export const BASE_H1_PROPIO: Record<string, number> = ${obj(e.h1)};
export const BASE_APOYO_LARGO: Record<string, number> = ${obj(e.apoyo)};
export const BASE_MARCOS_MULTIPLES: Record<string, number> = ${obj(e.marcosMultiples)};
/** Pantallas (carpetas con page.tsx) que todavía no usan MarcoPagina. */
export const BASE_SIN_MARCO: string[] = ${lista(e.sinMarco)};

/** admin_paginas_en_menu: direcciones estáticas que ninguna entrada ni pestaña de rutas.ts cubre. */
export const BASE_PAGINAS_FUERA_DEL_MENU: string[] = ${lista(fueraDelMenu)};

/** sin_emojis_en_producto: emoji por archivo (src/app y src/lib, sin pruebas). */
export const BASE_EMOJIS: Record<string, number> = ${obj(medirEmojis())};
`);
});
