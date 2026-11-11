import { Fragment, type ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// TEXTO CON ÉNFASIS — una frase de diccionario puede llevar etiquetas `<strong>…</strong>`, `<code>…</code>` o `<enlace>…</enlace>`.
// El diccionario dice DÓNDE va cada énfasis (en inglés el orden de las palabras cambia) y el componente dice CÓMO se pinta cada
// etiqueta. Así una frase con negritas sigue siendo UNA clave completa, nunca fragmentos pegados (PLAN-I18N §7, riesgo 1).
// Pura: sin Next ni Supabase; la importan servidor y cliente. Una etiqueta sin pintor se deja como texto (se nota, no se oculta).
// ═══════════════════════════════════════════════════════════════════════════

export type Pintores = Readonly<Record<string, (contenido: ReactNode) => ReactNode>>;

const ETIQUETA = /<([a-z][a-z0-9]*)>([\s\S]*?)<\/\1>/;

export function rico(texto: string, pintores: Pintores): ReactNode {
  const partes: ReactNode[] = [];
  let resto = texto;
  let i = 0;
  while (resto) {
    const m = ETIQUETA.exec(resto);
    if (!m) { partes.push(resto); break; }
    if (m.index > 0) partes.push(resto.slice(0, m.index));
    const pintor = pintores[m[1]];
    partes.push(<Fragment key={i++}>{pintor ? pintor(rico(m[2], pintores)) : m[0]}</Fragment>);
    resto = resto.slice(m.index + m[0].length);
  }
  return partes.length === 1 ? partes[0] : <>{partes.map((p, k) => <Fragment key={k}>{p}</Fragment>)}</>;
}
