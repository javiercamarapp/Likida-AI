import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sinComentarios } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// EL TOPE DE CONSULTA PROTEGÍA UN SOLO ARCHIVO. (AUDITORÍA 8, ALTO REINCIDENTE)
//
// `acotada()` nació dentro de `repo.ts`, así que solo cubría lo que pasaba por
// ahí. `conv.ts`, `costos.ts` y `config.ts` llamaban a `supabaseAdmin()` en
// crudo — ONCE de los trece pasos del cierre, incluidos el mutex del viaje, la
// barrera de ráfaga y la conversación.
//
// Una consulta colgada en esos caminos no tenía techo, y el webhook muere a los
// 120 s: la liquidación queda escrita, el operador no recibe ni resumen ni PDF,
// no se alcanza a escribir el `logger.error` porque el proceso muere antes del
// `catch`, y Meta no reintenta porque ya recibió su 200.
//
// Que fuera REINCIDENTE es el dato: el mecanismo era correcto y estaba probado,
// pero vivía en un archivo en vez de en la frontera. Moverlo a `presupuesto.ts`
// no basta — sin esta prueba, el próximo archivo que hable con Supabase nace
// otra vez sin techo, y nada falla hasta que algo se cuelga en producción.
// ═══════════════════════════════════════════════════════════════════════════

/** Los archivos por los que pasa el cierre de una liquidación. */
const CAMINO_DEL_CIERRE = [
  'src/lib/cuadra/repo.ts',
  'src/lib/cuadra/conv.ts',
  'src/lib/cuadra/costos.ts',
  'src/lib/cuadra/config.ts',
];

describe('ninguna consulta del cierre se queda sin techo', () => {
  it.each(CAMINO_DEL_CIERRE)('%s no llama a supabaseAdmin() en crudo', (archivo) => {
    const src = sinComentarios(readFileSync(archivo, 'utf8'));
    // `await supabaseAdmin()` sin `acotada(` delante es una consulta sin tope.
    const crudas = [...src.matchAll(/await supabaseAdmin\(\)/g)].length;
    expect(
      crudas,
      `${archivo} tiene consultas sin tope. Envuélvelas: await acotada(supabaseAdmin()…, 'etiqueta'). ` +
      'Sin techo, un cuelgue se come los 120 s de la función y el operador se queda sin PDF ' +
      'sobre una liquidación que SÍ se escribió.',
    ).toBe(0);
  });

  it('y hay consultas de verdad que contar (si no, esto no vigila nada)', () => {
    const total = CAMINO_DEL_CIERRE.reduce(
      (n, f) => n + [...sinComentarios(readFileSync(f, 'utf8')).matchAll(/acotada\(supabaseAdmin\(\)/g)].length, 0)
    expect(total).toBeGreaterThan(20);
  });

  it('`acotada` vive en la frontera, no dentro de un consumidor', () => {
    // La causa de que fuera reincidente: estaba en `repo.ts`, así que "usarla"
    // exigía importar del módulo de acceso a datos, y quien no lo hacía no
    // notaba nada.
    const pres = readFileSync('src/lib/cuadra/presupuesto.ts', 'utf8');
    expect(pres).toMatch(/export async function acotada/);
    expect(sinComentarios(readFileSync('src/lib/cuadra/repo.ts', 'utf8')))
      .not.toMatch(/(async )?function acotada/);
  });

  it('el tope y su margen salen del mismo sitio que el presupuesto', () => {
    // Si el tope viviera lejos de `MARGEN_CIERRE_MS` y del `maxDuration`, nadie
    // volvería a cuadrar los tres números entre sí.
    const pres = readFileSync('src/lib/cuadra/presupuesto.ts', 'utf8');
    expect(pres).toMatch(/TOPE_CONSULTA_MS/);
    expect(pres).toMatch(/GRACIA_TOPE_MS/);
  });
});
