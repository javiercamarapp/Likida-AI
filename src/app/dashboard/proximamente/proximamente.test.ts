/* eslint-disable security/detect-non-literal-fs-filename -- pruebas que leen el árbol de FUENTE del propio repo; ninguna ruta viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENIDO_PROXIMAMENTE } from './contenido';
import { MODULOS_PROXIMAMENTE_PERFIL, RUTAS_PERFIL_CINCO_AGENTES, rutaProximamenteEnPerfil } from '@/lib/auth/visibilidad';

const leer = (rel: string) => readFileSync(join(process.cwd(), 'src/app/dashboard/proximamente', rel), 'utf8');

describe('la pantalla «Próximamente» no toca datos de la flota', () => {
  const fuentes = { componente: leer('proximamente.tsx'), pagina: leer('[modulo]/page.tsx'), contenido: leer('contenido.ts') };

  it('ningún archivo consulta la base ni los repositorios de los agentes', () => {
    for (const [nombre, f] of Object.entries(fuentes)) {
      expect(f, nombre).not.toMatch(/supabase/i);
      expect(f, nombre).not.toMatch(/@\/lib\/likida\//);
      expect(f, nombre).not.toMatch(/\.from\(|\.rpc\(/);
    }
  });

  it('sin acciones de servidor, formularios ni botones de acción', () => {
    for (const [nombre, f] of Object.entries(fuentes)) {
      expect(f, nombre).not.toMatch(/['"]use server['"]/);
      expect(f, nombre).not.toMatch(/<form|<button|<input|FormaConAviso|onClick|fetch\(/);
    }
  });

  it('lo único que lee la página es sesión y perfil', () => {
    expect(fuentes.pagina).toMatch(/resolverTenantEfectivo\('\/dashboard'/);
    expect(fuentes.pagina).toMatch(/perfilDeTenant\(/);
    expect(fuentes.pagina).toMatch(/rutaProximamenteEnPerfil\(/);
  });

  it('el componente es accesible: encabezado, región con nombre y la etiqueta «Próximamente»', () => {
    expect(fuentes.componente).toMatch(/<h1 id="proximamente-titulo"/);
    expect(fuentes.componente).toMatch(/aria-labelledby="proximamente-titulo"/);
    expect(fuentes.componente).toContain('Próximamente');
  });
});

describe('el contenido por módulo', () => {
  it('hay uno por cada módulo «próximamente» (ninguno hoy: A4/A5 se encendieron el 18-oct-2026)', () => {
    expect(Object.keys(CONTENIDO_PROXIMAMENTE).sort()).toEqual([...MODULOS_PROXIMAMENTE_PERFIL].sort());
    for (const [modulo, c] of Object.entries(CONTENIDO_PROXIMAMENTE)) {
      expect(RUTAS_PERFIL_CINCO_AGENTES[c!.rutaReal], modulo).toBe(modulo);
      expect(rutaProximamenteEnPerfil('cinco_agentes', c!.rutaReal), modulo).toBe(true);
      expect(c!.puntos.length).toBeGreaterThanOrEqual(3);
      expect(c!.queHara.length).toBeGreaterThan(20);
    }
  });
});
