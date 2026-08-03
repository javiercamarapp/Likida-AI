import { TZ_MX } from './formato';

/**
 * El encabezado "Buenas tardes, Javier · lunes, 3 de agosto de 2026" que
 * abre las DOS consolas (/admin y /dashboard). Vive aquí, no en
 * `formato.ts`: ese archivo no importa nada a propósito (el motor puro y el
 * bundle del webhook lo usan), y un saludo no tiene por qué viajar en el
 * webhook de WhatsApp.
 *
 * Tampoco es `fechaMx()`: esa imprime la fecha FISCAL ("03 ago 2026"), la
 * que el contralor cruza contra su PDF y que por eso tiene una sola
 * representación en todo el producto. Esta es prosa de encabezado, con día
 * de la semana y mes completo — otro trabajo, otro formato.
 */
export function saludo(fecha: Date = new Date()): string {
  const h = fecha.getUTCHours() - 6; // hora de México, aproximada — un saludo no necesita el minuto exacto
  const hora = ((h % 24) + 24) % 24;
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

export function fechaLarga(fecha: Date = new Date()): string {
  return fecha.toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ_MX,
  });
}
