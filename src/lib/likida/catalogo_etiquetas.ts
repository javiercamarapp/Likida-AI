// Etiquetas únicas para los combos de catálogo (R15-ux-01, auditoría 35).
//
// El combo identifica lo que el usuario TECLEA contra el texto de cada opción.
// Dos operadores activos con el mismo nombre (solo el teléfono es único, mig.
// 0024) producían dos líneas idénticas en el `<datalist>` y el cliente
// resolvía al primero: el viaje y su anticipo se asignaban —y el WhatsApp
// salía— al homónimo equivocado. Aquí se garantiza que, dentro de lo que el
// servidor ofrece de una vez, NO haya dos etiquetas iguales.

export interface FilaCatalogo {
  id: string;
  etiqueta: string;
  /** Lo que distingue a la fila de un homónimo (p. ej. «tel. ···4821»). Solo se
   *  muestra cuando hay colisión; debe ser un dato que el panel ya enseña. */
  pista?: string | null;
}

/** Clave de comparación: la misma que usa el combo al resolver lo tecleado. */
export function claveEtiqueta(e: string): string {
  return e.trim().toLowerCase();
}

/** Últimos 4 dígitos del teléfono como pista, o null si no hay suficientes. */
export function pistaTelefono(telefono: unknown): string | null {
  if (typeof telefono !== 'string') return null;
  const d = telefono.replace(/\D/g, '');
  return d.length >= 4 ? `tel. ···${d.slice(-4)}` : null;
}

/**
 * Devuelve las mismas filas con etiquetas únicas. Los que no colisionan quedan
 * intactos; los homónimos reciben « · pista». Si la pista falta o también
 * coincide, se añade un ordinal estable (« · 2») para no volver a empatar.
 */
export function desambiguarEtiquetas(filas: FilaCatalogo[]): Array<{ id: string; etiqueta: string }> {
  const grupos = new Map<string, number>();
  for (const f of filas) grupos.set(claveEtiqueta(f.etiqueta), (grupos.get(claveEtiqueta(f.etiqueta)) ?? 0) + 1);

  const conPista = filas.map((f) => {
    const colisiona = (grupos.get(claveEtiqueta(f.etiqueta)) ?? 0) > 1;
    return { id: f.id, etiqueta: colisiona && f.pista ? `${f.etiqueta} · ${f.pista}` : f.etiqueta };
  });

  // Lo que aún empata (sin pista, o pista repetida) lleva ordinal por orden de aparición.
  const vistos = new Map<string, number>();
  const total = new Map<string, number>();
  for (const f of conPista) total.set(claveEtiqueta(f.etiqueta), (total.get(claveEtiqueta(f.etiqueta)) ?? 0) + 1);
  return conPista.map((f) => {
    const k = claveEtiqueta(f.etiqueta);
    if ((total.get(k) ?? 0) <= 1) return f;
    const n = (vistos.get(k) ?? 0) + 1;
    vistos.set(k, n);
    return { id: f.id, etiqueta: `${f.etiqueta} · ${n}` };
  });
}

/** Opciones cuya etiqueta coincide EXACTAMENTE con lo tecleado. El combo solo
 *  fija un id cuando hay UNA; con varias no adivina (ver combo-catalogo.tsx). */
export function coincidencias<T extends { etiqueta: string }>(opciones: T[], tecleado: string): T[] {
  const k = claveEtiqueta(tecleado);
  return k === '' ? [] : opciones.filter((o) => claveEtiqueta(o.etiqueta) === k);
}
