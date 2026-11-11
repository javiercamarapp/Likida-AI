import type { ParametrosVencidas } from '@/lib/admin/cola-aprobacion';

/**
 * Lee del formulario los parámetros del vaciado por lotes. Pura. NO los corrige en silencio: un número ilegible llega como `NaN` y
 * `normalizarParametros` (cola-aprobacion.ts) lo rechaza con texto de pantalla — «0 días» o un texto no pueden vaciar la bandeja entera.
 * Campo vacío = «usa el valor por omisión» (30 días, lote de 50, todos los tipos).
 */
export function leerParametrosLote(fd: FormData): ParametrosVencidas {
  const num = (k: string): number | undefined => {
    const v = String(fd.get(k) ?? '').trim();
    return v === '' ? undefined : Number(v);
  };
  const tiposTexto = String(fd.get('tipos') ?? '').trim();
  const tipos = tiposTexto === '' ? undefined : tiposTexto.split(/[\s,;]+/).filter(Boolean);
  return { dias: num('dias'), limite: num('limite'), ...(tipos ? { tipos } : {}) };
}

/** Pura. `esperadas` es lo que el dry-run contó; ausente o ilegible = `null` (no se ejecuta). */
export function leerEsperadas(fd: FormData): number | null {
  const v = String(fd.get('esperadas') ?? '').trim();
  if (v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
