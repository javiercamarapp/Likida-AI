import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resumirDeriva, commitsSinDesplegar, RUTAS_QUE_CORREN } from './deriva-sin-desplegar.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// OP-A6 (auditoría 31, ALTO) — el invariante del cotejo se tragó dos archivos
// de producción del camino del dinero y el pulso salió verde SIETE veces.
//
// El caso real: el 12-sep-2026 se mergea `5ce91b2`, cuyo asunto no lleva
// `[deploy]`, con `cuadre/desde_db.ts` (ARQ-C2 — con acumulado $100,000 y un
// ticket de diésel en efectivo de $4,700 fotografiado dos veces, el previo sale
// $90,600 donde lo correcto son $95,300) y `sat_descarga/ciclo.ts` (AG-C1).
// `ultimo-deploy-en-asunto.mjs` devuelve `cfa00ab`, `git merge-base
// --is-ancestor cfa00ab cfa00ab` es verdadero, y el paso imprime «Producción
// corre el último [deploy] o uno posterior» y sale 0.
//
// La pregunta vieja es sobre la INTENCIÓN («¿aterrizó lo último que se pidió
// publicar?»); la que faltaba es sobre el ESTADO («¿qué código de master no
// está corriendo?»). Las dos son necesarias: quedarse atrás a propósito es el
// flujo documentado, pero no puede ser SILENCIOSO.
// ═══════════════════════════════════════════════════════════════════════════

describe('resumirDeriva — el veredicto', () => {
  it('sin commits pendientes lo dice y no avisa de nada', () => {
    const r = resumirDeriva([]);
    expect(r.hay).toBe(false);
    expect(r.cuantos).toBe(0);
    expect(r.mensaje).toContain('no hay deriva');
  });

  it('EL CASO REAL: el merge de la auditoría 30 sin [deploy] se nombra, con sha y asunto', () => {
    const r = resumirDeriva([
      { sha: '5ce91b207729d04b0a6058e041d6e44783b7fd1f', asunto: 'Auditoría 30 — 12 rubros, 122 hallazgos, 3 arreglos con prueba · global 6.0 → 5.2 (#460)' },
    ]);
    expect(r.hay, 'el pulso salió verde siete veces sobre exactamente este commit').toBe(true);
    expect(r.cuantos).toBe(1);
    expect(r.mensaje).toContain('5ce91b2');
    expect(r.mensaje).toContain('Auditoría 30');
    // El aviso sirve solo si dice cómo se arregla.
    expect(r.mensaje).toMatch(/Redeploy|\[deploy\]/);
  });

  it('con varios commits los lista todos y pluraliza', () => {
    const r = resumirDeriva([
      { sha: 'aaaaaaa1111111111111111111111111111111111', asunto: 'fix: uno' },
      { sha: 'bbbbbbb2222222222222222222222222222222222', asunto: 'fix: dos' },
    ]);
    expect(r.cuantos).toBe(2);
    expect(r.mensaje).toContain('2 commits');
    expect(r.mensaje).toContain('aaaaaaa');
    expect(r.mensaje).toContain('bbbbbbb');
  });
});

// El doble de `correrGit`: recibe los argumentos de git como arreglo (sin
// shell, ver el comentario de `commitsSinDesplegar`) y devuelve texto. Se
// estrecha aquí para no tocar el script.
const sinDesplegar = commitsSinDesplegar as (
  desplegado: string, ref: string, ejecutar: (args: string[]) => string,
) => Array<{ sha: string; asunto: string }>;

describe('commitsSinDesplegar — qué le pregunta a git', () => {
  it('acota el rango a lo que CORRE: src/ y supabase/, no docs/ ni normas/', () => {
    let args: string[] = [];
    sinDesplegar('cfa00ab', 'origin/master', (a: string[]) => { args = a; return ''; });
    expect(args).toContain('cfa00ab..origin/master');
    for (const ruta of RUTAS_QUE_CORREN) expect(args).toContain(ruta);
    expect(args).not.toContain('docs/');
    expect(args).not.toContain('normas/');
  });

  // El ref entra por `process.argv` y, en el workflow, sale de un `curl` a
  // `/api/health`: es entrada externa. Si viajara dentro de una cadena para el
  // shell, `a;rm -rf /` sería una inyección de comandos — la clase que CodeQL
  // marca en `security-and-quality`. Con argumentos sueltos no hay shell que
  // interprete nada: el ref raro llega ENTERO como un argumento más y git lo
  // rechaza por inválido.
  it('los refs viajan como ARGUMENTOS, nunca dentro de una cadena para el shell', () => {
    let args: string[] = [];
    sinDesplegar('a;rm -rf /', 'origin/master', (a: string[]) => { args = a; return ''; });
    expect(args, 'el ref con `;` tiene que llegar entero, no partido en dos comandos')
      .toContain('a;rm -rf /..origin/master');
    expect(Array.isArray(args)).toBe(true);
  });

  it('el script no le pasa una cadena al shell: usa execFileSync con argumentos', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('scripts/ci/deriva-sin-desplegar.mjs', 'utf8');
    expect(src).toContain('execFileSync');
    expect(src, 'un `execSync` con plantilla es la inyección que este arreglo quitó')
      .not.toMatch(/execSync\(`/);
  });

  it('parsea sha y asunto con el separador de unidad (un asunto con | no lo rompe)', () => {
    const filas = sinDesplegar('x', 'y', () =>
      'abc123\x1ffix(a): algo | con pipe\ndef456\x1ffix(b): otro\n');
    expect(filas).toEqual([
      { sha: 'abc123', asunto: 'fix(a): algo | con pipe' },
      { sha: 'def456', asunto: 'fix(b): otro' },
    ]);
  });
});

describe('salud-produccion.yml — cableado del detector', () => {
  const wf = readFileSync('.github/workflows/salud-produccion.yml', 'utf8');

  it('corre el detector de deriva', () => {
    expect(wf).toContain('deriva-sin-desplegar.mjs');
  });

  it('avisa sin tumbar el pulso: quedarse atrás a propósito es el flujo documentado', () => {
    // El paso del detector no puede llevar `exit 1`: el rojo está reservado
    // para producción caída o para un `[deploy]` que no aterrizó.
    const paso = wf.slice(wf.indexOf('deriva-sin-desplegar.mjs'));
    const finDelPaso = paso.indexOf('\n      - name:');
    expect(paso.slice(0, finDelPaso > 0 ? finDelPaso : undefined)).not.toContain('exit 1');
  });

  it('el cotejo viejo sigue ahí: el detector SUMA una pregunta, no sustituye la otra', () => {
    expect(wf).toContain('ultimo-deploy-en-asunto.mjs');
    expect(wf).toContain('git merge-base --is-ancestor');
  });
});
