import { usd, numero } from '@/lib/formato';

/**
 * Presets de formato en vez de recibir una función callback como prop —
 * una función NO es serializable cruzando el límite Server→Client
 * Component (`formato={(v) => usd(v)}` pasado desde una página server
 * revienta con "Functions cannot be passed directly to Client
 * Components"). Con un preset de texto, la página server solo pasa un
 * string plano; la función real se resuelve AQUÍ DENTRO, ya del lado
 * del cliente.
 */
export type FormatoPreset = 'usd' | 'numero' | 'entero' | 'porcentaje' | 'porcentajeSigno';

export function resolverFormato(preset: FormatoPreset = 'numero'): (v: number) => string {
  switch (preset) {
    case 'usd': return (v) => usd(v);
    case 'porcentaje': return (v) => `${Math.round(v)}%`;
    // Con signo explícito en positivos — MarginDivergingBars (rentabilidad
    // ±): "+22%"/"-8%", nunca solo "22%"/"-8%" (ambiguo cuál lado es cuál).
    case 'porcentajeSigno': return (v) => `${v >= 0 ? '+' : ''}${Math.round(v)}%`;
    case 'entero': return (v) => String(Math.round(v));
    case 'numero':
    default: return (v) => numero(v);
  }
}
