import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// Auditoría 5 · `.env.example` y `DEPLOY.md` como parte del sistema, no como
// prosa suelta.
//
// Dos hallazgos con la misma forma: el código lee una variable, el documento al
// que manda el runbook no la menciona, y si falta **el sistema arranca igual,
// mal y en silencio**. Los casos medidos fueron `SENTRY_DSN` (nadie recibe los
// errores) y `DEMO_TENANT_ID` (el panel consulta otro tenant y pinta cero
// liquidaciones, que en un demo se lee como "el producto no guardó nada").
//
// Un documento no se puede "probar", pero sí se puede probar que no se ha
// quedado atrás del código, que es exactamente cómo se rompieron los dos.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = process.cwd();

// Las pone la plataforma o el arnés de pruebas: no van en `.env.example`.
const DE_LA_PLATAFORMA = new Set([
  'NODE_ENV', 'VERCEL_ENV', 'NEXT_RUNTIME',
  'TICKET_PATH', 'TICKET_HOY', 'TICKET_ANTICIPO',
]);

function archivosFuente(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) archivosFuente(p, acc);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) acc.push(p);
  }
  return acc;
}

/** Variables que el código lee de verdad, medidas sobre el árbol de fuentes. */
function leidasPorElCodigo(): Set<string> {
  const out = new Set<string>();
  for (const f of archivosFuente(join(RAIZ, 'src'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (!DE_LA_PLATAFORMA.has(m[1])) out.add(m[1]);
    }
  }
  return out;
}

/** Variables declaradas (no comentadas) en `.env.example`. */
function declaradasEnEjemplo(): string[] {
  return readFileSync(join(RAIZ, '.env.example'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('=')[0].trim())
    .filter(Boolean);
}

describe('.env.example no se queda atrás del código', () => {
  it('documenta TODAS las variables que el código lee', () => {
    const declaradas = new Set(declaradasEnEjemplo());
    const faltantes = [...leidasPorElCodigo()].filter((v) => !declaradas.has(v)).sort();
    expect(faltantes).toEqual([]);
  });

  it('no documenta variables que ya no lee nadie', () => {
    // `FACTURAPI_KEY`, `UPSTASH_*`, `QSTASH_TOKEN` sobrevivieron a que se
    // quitaran esas dependencias. Documentación muerta que ensucia el
    // inventario: al desplegar hay que decidir una por una si hace falta.
    const leidas = leidasPorElCodigo();
    const sobrantes = declaradasEnEjemplo().filter((v) => !leidas.has(v)).sort();
    expect(sobrantes).toEqual([]);
  });

  it('no declara la misma variable dos veces', () => {
    // `SENTRY_DSN` aparecía dos veces con dos comentarios distintos: al pegarlas
    // en Vercel una pisa a la otra y no hay forma de saber cuál manda.
    const todas = declaradasEnEjemplo();
    const repetidas = todas.filter((v, i) => todas.indexOf(v) !== i);
    expect(repetidas).toEqual([]);
  });

  it('no promete palancas que el código no tiene', () => {
    // El "Plan B demo en vivo" (ANTHROPIC_API_KEY / GOOGLE_API_KEY) no lo lee
    // nadie: `openrouter.ts` solo mira OPENROUTER_API_KEY. Descubrirlo durante
    // el demo cuesta el tiempo de ponerla y redesplegar antes de entender que no
    // había ruta. Peligroso porque las palancas CUADRA_MODEL_* del mismo bloque
    // comentado SÍ funcionan, y desde el archivo no se distingue cuál es cuál.
    const texto = readFileSync(join(RAIZ, '.env.example'), 'utf8');
    const leidas = leidasPorElCodigo();
    for (const v of ['ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'FACTURAPI_KEY', 'QSTASH_TOKEN']) {
      if (!leidas.has(v)) expect(texto).not.toContain(v);
    }
  });
});

describe('DEPLOY.md pide lo que hace falta para que el sistema no arranque ciego', () => {
  const deploy = () => readFileSync(join(RAIZ, 'DEPLOY.md'), 'utf8');

  it('nombra las variables cuya ausencia es silenciosa', () => {
    const texto = deploy();
    for (const v of ['SENTRY_DSN', 'DASHBOARD_SECRET', 'DASHBOARD_PASSCODE', 'DEMO_TENANT_ID']) {
      expect(texto, `DEPLOY.md no menciona ${v}`).toContain(v);
    }
  });

  it('dice dónde se miran los logs cuando algo falla', () => {
    // Es el documento al que se acude a las 3 a.m. y no contenía nada de lo que
    // a esa hora se necesita.
    expect(deploy()).toMatch(/vercel logs|runtime log/i);
  });
});
