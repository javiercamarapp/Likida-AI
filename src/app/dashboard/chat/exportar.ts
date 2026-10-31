import type { Respuesta, Visual } from './respuestas';

/** Los visuales de una respuesta, en el orden en que se pintan. */
export function visualesDe(r: Respuesta): Visual[] {
  return [...(r.visual ? [r.visual] : []), ...(r.visuales ?? [])];
}

const escaparCsv = (s: string) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

/** CSV de una tabla de respuesta (clave, valor): lo MISMO que se ve en pantalla, ya formateado. */
export function tablaACsv(filas: Array<[string, string]>): string {
  return ['Concepto,Valor', ...filas.map(([k, v]) => `${escaparCsv(k)},${escaparCsv(String(v))}`)].join('\n');
}

/** Texto plano de una respuesta para copiarla: el texto y, debajo, cada tabla / cifra en líneas «Concepto: valor». */
export function textoParaCopiar(r: Respuesta): string {
  const partes = [r.texto];
  for (const v of visualesDe(r)) {
    if (v.tipo === 'tabla') partes.push(v.filas.map(([k, val]) => `${k}: ${val}`).join('\n'));
    else if (v.tipo === 'cifra') partes.push(v.nota ? `${v.valor} — ${v.nota}` : v.valor);
    else if (v.tipo === 'dona') partes.push(v.segmentos.map((s) => `${s.etiqueta}: ${s.valor}`).join('\n'));
  }
  return partes.filter(Boolean).join('\n\n');
}

/** Descarga un texto como archivo (Blob + enlace temporal); devuelve `false` si el navegador no lo permitió. */
export function descargar(nombre: string, contenido: string, tipo: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}
