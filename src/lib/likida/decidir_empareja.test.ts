import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sinComentarios } from '@/lib/pruebas/codigo';

// ═══════════════════════════════════════════════════════════════════════════
// 31-jul-2026 · DOS LISTAS DEL MISMO HECHO, EN DOS ARCHIVOS.
//
// `decidirFoto` empareja por monto ciertos motivos —el acercamiento del
// protocolo de dos fotos y el voucher de la terminal—, y para eso necesita los
// gastos ya registrados del viaje. El processor NO los consulta siempre: es una
// lectura que en el camino normal no se paga.
//
// Así que hay una lista en cada lado, y tienen que decir lo mismo. Al añadir
// `solo_pago` a `decidirFoto` esto se rompió en el acto: el processor seguía
// consultando solo para `solo_codigo`, así que al voucher le llegaba `gastos`
// VACÍO, `emparejarPorMonto` no encontraba nada, y el operador recibía
// "mándame el ticket" por uno que ya había mandado.
//
// El bug no habría dado error en ningún lado. El dinero ni siquiera se
// duplicaba —el voucher no entraba— así que el síntoma era un mensaje molesto
// que nadie relaciona con nada, sobre el operador que hizo todo bien.
//
// Es la misma familia que `mxn()` y las claves del SAT: el mismo hecho escrito
// dos veces, en dos archivos, esperando a separarse.
// ═══════════════════════════════════════════════════════════════════════════

/** Los motivos que `decidirFoto` resuelve emparejando contra los gastos. */
const enDecidir = (() => {
  // Se busca el `if` que ABRE la rama del emparejamiento, caminando hacia atrás
  // desde la llamada. La primera versión hacía `indexOf('emparejarPorMonto')` y
  // caía en el IMPORT del principio del archivo: leía cero motivos y las tres
  // pruebas fallaban señalando al sitio equivocado. Un extractor que apunta mal
  // no es una red laxa, es una red que miente.
  const lineas = sinComentarios(readFileSync('src/lib/likida/intake/decidir.ts', 'utf8')).split('\n');
  const i = lineas.findIndex((l) => l.includes('emparejarPorMonto(r.gasto.monto'));
  if (i < 0) return [];
  let j = i;
  while (j >= 0 && !lineas[j].trimStart().startsWith('if (')) j--;
  return [...lineas[j].matchAll(/r\.motivo === '([a-z_]+)'/g)].map((m) => m[1]).sort();
})();

/** Los motivos para los que el processor SÍ paga la consulta de gastos. */
const enProcessor = (() => {
  const src = sinComentarios(readFileSync('src/lib/likida/processor.ts', 'utf8'));
  const m = src.match(/const EMPAREJAN = \[([^\]]+)\]/);
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort() : [];
})();

describe('el processor consulta los gastos justo para los motivos que emparejan', () => {
  it('se leyeron las dos listas de verdad', () => {
    // Sin esto, dos listas vacías serían "iguales" y la red no vigilaría nada.
    expect(enDecidir.length, 'no se encontraron motivos en decidir.ts').toBeGreaterThan(0);
    expect(enProcessor.length, 'no se encontró EMPAREJAN en processor.ts').toBeGreaterThan(0);
  });

  it('dicen lo mismo', () => {
    expect(
      enProcessor,
      'si `decidirFoto` empareja un motivo que el processor no consulta, `gastos` llega ' +
      'VACÍO: nunca encuentra destino y el operador recibe "mándame el ticket" por uno ' +
      'que ya mandó. Y al revés es una consulta que se paga para nada.',
    ).toEqual(enDecidir);
  });

  it('y el voucher está en las dos', () => {
    // El caso concreto que motivó la red, para que se lea qué se protege.
    expect(enDecidir).toContain('solo_pago');
    expect(enProcessor).toContain('solo_pago');
  });
});
