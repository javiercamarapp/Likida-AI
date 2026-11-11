/* eslint-disable security/detect-non-literal-fs-filename -- comprueba stubs dentro del propio repo */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REDIRECCIONES_308 } from './redirecciones_308';
import { ADMIN, archivos, leer, ruta, sinComentarios, direccionesEstaticas } from './medir';

// Guarda `redirecciones_308` (Fase 0, K3). Una pantalla que cambia de dirección deja un stub con redirección PERMANENTE que conserva la
// consulta (`redirigirPermanente`), no un `redirect()` temporal (307) ni una página muerta. El registro está vacío hasta la Fase 1.
const paginas = archivos(ADMIN, /^page\.tsx$/);
const usa308 = (f: string) => /\b(redirigirPermanente|permanentRedirect)\s*\(/.test(sinComentarios(leer(f)));
const direccion = (f: string) => ruta(f).replace(/^app/, '').replace(/\/page\.tsx$/, '');

/** Detector de alias: `export default function X(...) {` seguido (tras declaraciones simples) de `redirect(`. Por pasos, sin regex anidada. */
function detectaAlias(codigo: string): boolean {
  const plano = codigo.split(/\s+/).join(' ');
  const ini = plano.indexOf('export default ');
  if (ini < 0) return false;
  const llave = plano.indexOf('{', ini);
  const cabecera = plano.slice(ini, llave);
  if (llave < 0 || !cabecera.includes('function')) return false;
  for (const sent of plano.slice(llave + 1).split(';')) {
    const t = sent.trim().replace(/^await /, '');
    if (t.startsWith('redirect(') || t.startsWith('redirect (')) return true;
    if (!t.startsWith('const ') && !t.startsWith('let ')) return false;
  }
  return false;
}
const soloRedirige = (f: string) => detectaAlias(sinComentarios(leer(f)));

describe('redirecciones_308', () => {
  it('cada entrada del registro tiene su stub 308 y su destino existe', () => {
    const existentes = new Set(direccionesEstaticas());
    for (const [vieja, nueva] of Object.entries(REDIRECCIONES_308)) {
      const archivo = join(ADMIN, vieja.replace(/^\/admin\/?/, ''), 'page.tsx');
      expect(existsSync(archivo), `falta el stub de ${vieja}`).toBe(true);
      expect(usa308(archivo), `${vieja} debe usar redirigirPermanente`).toBe(true);
      expect(leer(archivo)).toContain(nueva);
      expect(existentes.has(nueva.split('?')[0]), `destino ${nueva} no existe`).toBe(true);
    }
  });
  it('ninguna página usa redirección permanente fuera del registro', () => {
    const registradas = new Set(Object.keys(REDIRECCIONES_308));
    expect(paginas.filter((f) => usa308(f) && !registradas.has(direccion(f))).map(ruta)).toEqual([]);
  });
  it('ninguna página es un alias que solo hace redirect() temporal', () => {
    expect(paginas.filter(soloRedirige).map(ruta)).toEqual([]);
  });
  it('el detector de alias distingue una página real de un stub', () => {
    const stub = "export default async function P() { redirect('/admin/x'); }";
    expect(detectaAlias(stub)).toBe(true);
    const real = "export default async function P() { const x = await leer(); return <div/>; }";
    expect(detectaAlias(real)).toBe(false);
  });
});
