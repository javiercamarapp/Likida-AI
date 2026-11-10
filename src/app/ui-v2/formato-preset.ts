import { usd, numero, mxn, mxnCompacto, litros } from '@/lib/formato';

/**
 * Presets de formato en vez de recibir una función callback como prop —
 * una función NO es serializable cruzando el límite Server→Client
 * Component (`formato={(v) => usd(v)}` pasado desde una página server
 * revienta con "Functions cannot be passed directly to Client
 * Components"). Con un preset de texto, la página server solo pasa un
 * string plano; la función real se resuelve AQUÍ DENTRO, ya del lado
 * del cliente.
 *
 * `mxn`/`litros` se suman aquí (no se reimplementan) para que `/dashboard`
 * — la moneda real del cliente, nunca la de costo interno de IA — pueda
 * usar `KpiTile` sin duplicar `toLocaleString('es-MX')` fuera de
 * `src/lib/formato.ts` (lo bloquea `formato.test.ts`).
 */
export type FormatoPreset =
  | 'usd' | 'mxn' | 'mxnCompacto' | 'numero' | 'entero' | 'litros'
  | 'porcentaje' | 'porcentajeSigno';

export function resolverFormato(preset: FormatoPreset = 'numero'): (v: number) => string {
  switch (preset) {
    case 'usd': return (v) => usd(v);
    case 'mxn': return (v) => mxn(v);
    // FE-17: pesos ABREVIADOS para una tarjeta angosta — «$9,000 M» donde
    // «$9,000,000,000.00» se desborda. Debajo de un millón es `mxn()` exacto,
    // así que solo cambia lo que no cabía.
    case 'mxnCompacto': return (v) => mxnCompacto(v);
    case 'litros': return (v) => litros(v);
    case 'porcentaje': return (v) => `${Math.round(v)}%`;
    // Con signo explícito en positivos — MarginDivergingBars (rentabilidad
    // ±): "+22%"/"-8%", nunca solo "22%"/"-8%" (ambiguo cuál lado es cuál).
    case 'porcentajeSigno': return (v) => `${v >= 0 ? '+' : ''}${Math.round(v)}%`;
    // FE-17 (auditoría prod): era `String(Math.round(v))` — SIN separador de
    // millares, en 42 usos. "42350" y el "42,350" de la tarjeta de al lado son
    // la misma cifra escrita de dos formas, y a escala 50k el número que más
    // se lee (viajes del mes, comprobantes procesados) es justo el que pasaba
    // de cinco dígitos. `numero()` es el mismo separador que todo lo demás.
    case 'entero': return (v) => numero(Math.round(v));
    case 'numero':
    default: return (v) => numero(v);
  }
}
