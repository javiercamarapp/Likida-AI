import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GET as getSpec } from '@/app/api/v1/openapi/route';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 · M19 — el área de la llave de API se escribe DOS veces: en el
// `abrir(req, '…')` de la ruta y en la `description` del OpenAPI ("Área
// `dinero`"). Nada las unía: cambiar el código a `operacion` dejaba la suite
// verde y el contrato que el integrador descarga prometiendo lo contrario.
// Misma técnica que `ruta_pdf_sincronizada.test.ts`: leer los fuentes como
// texto y comparar.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = join(process.cwd(), 'src/app/api/v1');

/** `{ '/v1/clientes': { get: 'dinero' }, … }` leído de los route.ts reales. */
function areasDelCodigo(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const recorrer = (dir: string, ruta: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) {
        if (e !== 'openapi') recorrer(p, `${ruta}/${e.startsWith('[') ? `{${e.slice(1, -1)}}` : e}`);
        continue;
      }
      if (e !== 'route.ts') continue;
      const src = readFileSync(p, 'utf8');
      // Cada `export async function GET(...)` hasta el siguiente export: el
      // `abrir(req, 'x')` que contiene es el área de ese método.
      const bloques = src.split(/(?=export async function (?:GET|POST|PUT|PATCH|DELETE)\b)/);
      for (const b of bloques) {
        const m = /^export async function (GET|POST|PUT|PATCH|DELETE)\b/.exec(b);
        const a = /abrir\(req, '([a-z]+)'\)/.exec(b);
        if (m && a) (out[ruta] ??= {})[m[1].toLowerCase()] = a[1];
      }
    }
  };
  recorrer(RAIZ, '/v1');
  return out;
}

async function spec(): Promise<Record<string, Record<string, { description?: string; tags?: string[] }>>> {
  const r = await getSpec(new Request('https://app.likida.ai/api/v1/openapi'));
  return ((await r.json()) as { paths: Record<string, Record<string, { description?: string; tags?: string[] }>> }).paths;
}

describe('el área que declara el OpenAPI es la que el código pasa a abrir()', () => {
  it('CONTROL: el extractor encuentra las rutas de datos con su abrir()', () => {
    const areas = areasDelCodigo();
    expect(areas['/v1/viajes/{id}/contribucion']?.get).toBe('dinero');
    expect(Object.keys(areas).length).toBeGreaterThanOrEqual(5);
  });

  it('toda ruta de DINERO en el código lo declara en el spec, y toda área declarada coincide con el código', async () => {
    const areas = areasDelCodigo();
    const paths = await spec();
    const faltan: string[] = [];
    for (const [ruta, metodos] of Object.entries(areas)) {
      for (const [metodo, areaCodigo] of Object.entries(metodos)) {
        const op = paths[ruta]?.[metodo];
        if (!op) { faltan.push(`${metodo.toUpperCase()} ${ruta}: sin bloque en el spec`); continue; }
        const declarada = /Área `([a-z]+)`/.exec(op.description ?? '')?.[1];
        if (declarada && declarada !== areaCodigo) {
          faltan.push(`${metodo.toUpperCase()} ${ruta}: el spec dice "${declarada}" y abrir() pide "${areaCodigo}"`);
        }
        if (areaCodigo === 'dinero' && declarada !== 'dinero') {
          faltan.push(`${metodo.toUpperCase()} ${ruta}: abrir() pide dinero y el spec no lo declara`);
        }
        if (areaCodigo === 'dinero' && !(op.tags ?? []).includes('dinero')) {
          faltan.push(`${metodo.toUpperCase()} ${ruta}: falta el tag "dinero"`);
        }
      }
    }
    expect(faltan, faltan.join('\n')).toEqual([]);
  }, 30_000);
});
