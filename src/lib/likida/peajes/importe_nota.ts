// A37-S15-09: el monto de una nota de crédito se tecleaba y se le quitaban TODAS las comas:
// «1234,50» (coma decimal) se leía 123450 —100 veces más— y pasaba si cabía bajo lo reclamado.
// Ante la ambigüedad NO se adivina: una coma seguida de 1-2 dígitos al final se rechaza.

export type ImporteNota = { ok: true; monto: number } | { ok: false; motivo: string };

export function importeDeNota(texto: string): ImporteNota {
  const limpio = texto.trim().replace(/[$\s]/g, '');
  if (/,\d{1,2}$/.test(limpio) || /,\d{1,2}\.\d/.test(limpio)) {
    return { ok: false, motivo: 'El monto es ambiguo: usa punto para los centavos y coma solo para miles (ej. 1,234.50).' };
  }
  const monto = Number(limpio.replace(/,/g, ''));
  if (!Number.isFinite(monto)) return { ok: false, motivo: 'El monto de la nota de crédito no es un número.' };
  return { ok: true, monto };
}
