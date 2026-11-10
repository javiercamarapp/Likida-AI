/* eslint-disable security/detect-non-literal-fs-filename -- lee archivos del propio repo */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// R8: el kit nuevo pinta con componentes de ui-v2 y el marco de /admin pasa piezas a componentes de cliente. Una función cruzando de un
// componente de servidor a uno de cliente tumbó /dashboard en producción (PR #812): estas guardas lo cazan en el código fuente.
const leer = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');

/** Los atributos JSX de cada uso de `<Nombre ...>` (hasta el `>` de cierre de la etiqueta de apertura, respetando llaves). */
function usos(src: string, nombre: string): string[] {
  const out: string[] = [];
  for (let i = src.indexOf(`<${nombre}`); i >= 0; i = src.indexOf(`<${nombre}`, i + 1)) {
    const c = src[i + nombre.length + 1];
    if (c && /[A-Za-z0-9]/.test(c)) continue;
    let d = 0, k = i;
    for (; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') d--; else if (src[k] === '>' && d === 0 && src[k - 1] !== '=') break; }
    out.push(src.slice(i, k));
  }
  return out;
}

describe('kit nuevo: ninguna función cruza hacia componentes de ui-v2', () => {
  const kit = leer('kit.tsx');
  it('kit.tsx es de cliente y Cifra/Tarjeta/EstadoVacio no reciben funciones (los formatos cruzan como id)', () => {
    expect(kit.startsWith("'use client'")).toBe(true);
    for (const n of ['Cifra', 'Tarjeta', 'EstadoVacioV2']) {
      const u = usos(kit, n);
      expect(u.length, n).toBeGreaterThan(0);
      for (const t of u) expect(t, `${n}: ${t}`).not.toMatch(/=>|\bfunction\b|\bon[A-Z]\w*=/);
    }
  });
  it('StatCard/KpiTile reciben `formato` como id (FormatoPreset), no como función', () => {
    expect(kit).toMatch(/formato\?: FormatoPreset/);
    expect(kit).not.toMatch(/formato\??: \(/);
  });
});

describe('marco de /admin: el servidor no pasa funciones a los componentes de cliente del sidebar', () => {
  const chrome = leer('../chrome.tsx');
  it('cerrarSesion solo se usa en el form del propio chrome (servidor), no como prop de SidebarNav/AsideAdmin/MarcaAdmin/PieAdmin', () => {
    for (const n of ['SidebarNav', 'AsideAdmin', 'MarcaAdmin', 'PieAdmin']) {
      for (const t of usos(chrome, n)) expect(t, `${n}: ${t}`).not.toMatch(/cerrarSesion|=>|\bon[A-Z]\w*=/);
    }
    expect(chrome).toMatch(/<form action=\{cerrarSesion\}/);
  });
});
