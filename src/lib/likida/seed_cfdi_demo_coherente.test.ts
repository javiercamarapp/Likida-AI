import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const seed = readFileSync('supabase/seed.sql', 'utf8');
const centavos = (n: number) => Math.round(n * 100);

describe('A37-S63-07: el CFDI demo de diésel del seed cuadra con su propio XML', () => {
  const xml = seed.match(/<\?xml[^']*b7e3f1a2[^']*<\/cfdi:Comprobante>/)?.[0] ?? seed.match(/<\?xml[^']*HidroYPetro[^']*<\/cfdi:Comprobante>/)?.[0] ?? '';
  const num = (re: RegExp) => Number(xml.match(re)?.[1]);
  const subTotal = num(/SubTotal="([\d.]+)"/);
  const total = num(/ Total="([\d.]+)"/);
  const litros = num(/Cantidad="([\d.]+)"/);
  const traslados = [...xml.matchAll(/<cfdi:Traslado Base="([\d.]+)" Impuesto="(\d+)" TipoFactor="(\w+)" TasaOCuota="([\d.]+)" Importe="([\d.]+)"/g)]
    .map((m) => ({ base: Number(m[1]), imp: m[2], factor: m[3], tasa: Number(m[4]), importe: Number(m[5]) }));
  const ieps = traslados.find((t) => t.imp === '003');
  const iva = traslados.find((t) => t.imp === '002');

  it('IEPS = litros x cuota, sobre la base del subtotal', () => {
    expect(ieps && iva).toBeTruthy();
    expect(ieps!.base).toBe(subTotal);
    expect(centavos(ieps!.importe)).toBe(centavos(litros * ieps!.tasa));
  });
  it('IVA = 16 % de (subtotal + IEPS), y el total es la suma exacta', () => {
    expect(centavos(iva!.base)).toBe(centavos(subTotal + ieps!.importe));
    expect(centavos(iva!.importe)).toBe(centavos(iva!.base * 0.16));
    expect(centavos(total)).toBe(centavos(subTotal + ieps!.importe + iva!.importe));
    expect(centavos(Number(xml.match(/TotalImpuestosTrasladados="([\d.]+)"/)?.[1]))).toBe(centavos(ieps!.importe + iva!.importe));
  });
  it('la fila del gasto trae los mismos importes y el mismo total (4200)', () => {
    const fila = seed.match(/'03', ([\d.]+), ([\d.]+), ([\d.]+), current_date - 1, 0\.97/);
    expect(fila).toBeTruthy();
    expect([Number(fila![1]), Number(fila![2]), Number(fila![3])]).toEqual([subTotal, ieps!.importe, iva!.importe]);
    expect(seed).toMatch(/'diesel', 4200, 'DS-8801'/);
    expect(total).toBe(4200);
  });
});
