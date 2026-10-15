import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 32 c18, REN-C18-A1: la frontera de autenticación NO tenía techo de
// consulta. `acotada_guardiana.test.ts` cubre el camino caliente del webhook y
// los módulos del panel, pero ninguno de sus archivos es el que corre ANTES de
// todos ellos: la resolución de la llave y del tenant.
//
// Por qué importa el número: `TOPE_CONSULTA_MS` deja 9.5 s; sin él se heredan
// los 25 s del `BACKSTOP_MS` de `supabase/server.ts`. En las SEIS rutas con
// `maxDuration = 30`, un solo eslabón sin techo se come 25 de los 30 s — 83 %
// del presupuesto — para autenticar, antes de hacer nada útil.
//
// Y es seguro: agotar el tope entra por `{ data: null, error }`
// (`presupuesto.ts:254`), que es el camino que estos tres archivos YA tratan
// como «no pude preguntar» y nunca como «no existe» — endurecido así en las
// auditorías 12, 13 y 24. `llave-api.ts` lo dice en su cabecera: un error de
// lectura es 503 y NUNCA 401, porque un 401 haría que el TMS del cliente
// borrara su llave creyéndola inválida.
//
// OJO con la regex: `Buffer.from(` y `Array.from(` también casan `.from(`.
// `llave-api.ts` usa `Buffer.from` dos veces en su comparación de tiempo
// constante, así que aquí se descuentan explícitamente en vez de meter el
// archivo al guardia compartido, que no sabe distinguirlas.
// ═══════════════════════════════════════════════════════════════════════════
const sinComentarios = (fuente: string) =>
  fuente.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

// Las rutas van LITERALES a propósito: `readFileSync(variable)` levanta
// `security/detect-non-literal-fs-filename`, y el ratchet de lint no admite un
// aviso nuevo (166/166 heredados, 0 nuevos). El guardia compartido
// (`acotada_guardiana.test.ts`) carga ese aviso desde antes del ratchet.
const FRONTERA = [
  { archivo: 'src/lib/auth/llave-api.ts', consultas: 2, fuente: sinComentarios(readFileSync('src/lib/auth/llave-api.ts', 'utf8')) },
  { archivo: 'src/lib/auth/tenant-api.ts', consultas: 2, fuente: sinComentarios(readFileSync('src/lib/auth/tenant-api.ts', 'utf8')) },
  { archivo: 'src/lib/auth/tenant-efectivo.ts', consultas: 4, fuente: sinComentarios(readFileSync('src/lib/auth/tenant-efectivo.ts', 'utf8')) },
] as const;

describe('toda consulta de la frontera de auth lleva techo', () => {
  it.each(FRONTERA)('$archivo', ({ archivo, consultas, fuente }) => {
    // `.from(`/`.rpc(` reales = todos menos los de Buffer/Array.
    const brutas = (fuente.match(/\.(from|rpc)\(/g) ?? []).length;
    const falsos = (fuente.match(/\b(?:Buffer|Array)\.from\(/g) ?? []).length;
    const reales = brutas - falsos;
    const acotadas = (fuente.match(/\bacotada\(/g) ?? []).length;

    expect(reales, `control: ${archivo} consulta la base ${consultas} veces`).toBe(consultas);
    expect(acotadas, `${archivo}: ${reales} consultas y ${acotadas} acotada( — hay una sin techo`).toBe(reales);
  });

  it('los tres importan `acotada` del presupuesto, no una copia local', () => {
    for (const { archivo, fuente } of FRONTERA) {
      expect(fuente, archivo).toMatch(/import \{ acotada \} from '@\/lib\/likida\/presupuesto'/);
    }
  });
});
