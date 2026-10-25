/**
 * A37-S64-08: una fecha AAAA-MM-DD que EXISTE en el calendario.
 *
 * La regex sola deja pasar 2026-02-30 y `Date.parse` lo rueda al 2 de marzo en
 * V8; la base (columna `date`) lo rechaza y la pantalla decía «No se pudo
 * guardar» sin decir que la fecha era la causa. Se valida con ida y vuelta,
 * igual que `fecha()` de clientes.ts.
 */
export function esFechaReal(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
