import type { Recorrido } from './tipos';

/** Nombre estable: segmentos a-z0-9 separados por «.» o «-» (sin segmentos vacíos). */
const esAncla = (n: string) => n.length > 0 && n.split(/[.-]/).every((seg) => /^[a-z0-9]+$/.test(seg));
export const MAX_TITULO = 48;
export const MAX_TEXTO = 180;

/** Atributo estable para anclar un paso: `<Boton {...anclaTour('conexiones.subir-archivo')}>`.
 *  Es ADITIVO: no cambia clases, ids ni nombres accesibles (contrato anti-rotura de e2e). */
export const anclaTour = (nombre: string) => ({ 'data-tour': nombre }) as const;

/** Problemas de calidad de un recorrido (lista vacía = válido). Lo usan las
 *  pruebas de cada recorrido de los carriles A/C para no publicar uno roto. */
export function validarRecorrido(r: Recorrido): string[] {
  const p: string[] = [];
  if (!r.id) p.push('sin id');
  if (!Number.isInteger(r.version) || r.version < 1) p.push('version inválida');
  if (r.pasos.length === 0) p.push('sin pasos');
  const ids = new Set<string>();
  r.pasos.forEach((s, i) => {
    const n = `paso ${i + 1} (${s.id || '?'})`;
    if (!s.id) p.push(`${n}: sin id`);
    if (ids.has(s.id)) p.push(`${n}: id repetido`);
    ids.add(s.id);
    if (!s.titulo.trim()) p.push(`${n}: sin título`);
    if (s.titulo.length > MAX_TITULO) p.push(`${n}: título de ${s.titulo.length} (máx ${MAX_TITULO})`);
    if (!s.texto.trim()) p.push(`${n}: sin texto`);
    if (s.texto.length > MAX_TEXTO) p.push(`${n}: texto de ${s.texto.length} (máx ${MAX_TEXTO})`);
    if (s.ancla !== undefined && !esAncla(s.ancla)) p.push(`${n}: ancla «${s.ancla}» no es un nombre estable (a-z, 0-9, . -)`);
    if (s.avance?.tipo === 'accion') {
      if (!s.ancla && !s.avance.ancla) p.push(`${n}: avance por acción sin elemento`);
      if (s.avance.ancla && !esAncla(s.avance.ancla)) p.push(`${n}: ancla de avance inválida`);
      if (!s.accion) p.push(`${n}: avance por acción sin la frase «Aprieta aquí → …»`);
    }
    if (s.accion && (!s.accion.verbo.trim() || !s.accion.objetivo.trim())) p.push(`${n}: acción incompleta`);
    if (s.ruta !== undefined && !s.ruta.startsWith('/')) p.push(`${n}: ruta debe empezar con /`);
  });
  return p;
}
