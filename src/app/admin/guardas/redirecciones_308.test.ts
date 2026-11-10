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

/** `export default function X(...) { ...; redirect(...)` sin devolver JSX: una página que SOLO redirige. */
const soloRedirige = (f: string) => /export\s+default\s+(?:async\s+)?function\s+\w*\([^)]*\)\s*\{\s*(?:(?:const|let)\s[^;]+;\s*)*(?:await\s+)?redirect\s*\(/.test(sinComentarios(leer(f)));

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
    expect(/export\s+default\s+(?:async\s+)?function\s+\w*\([^)]*\)\s*\{\s*(?:(?:const|let)\s[^;]+;\s*)*(?:await\s+)?redirect\s*\(/.test(stub)).toBe(true);
    const real = "export default async function P() { const x = await leer(); return <div/>; }";
    expect(/export\s+default\s+(?:async\s+)?function\s+\w*\([^)]*\)\s*\{\s*(?:(?:const|let)\s[^;]+;\s*)*(?:await\s+)?redirect\s*\(/.test(real)).toBe(false);
  });
});
