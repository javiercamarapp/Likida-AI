import { Fragment, type ReactNode } from 'react';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { fechaMx, hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { crearTraductor, type Traductor } from '@/lib/i18n/traducir';
import type { DiccionarioDe } from '@/lib/i18n/catalogo';

// ═══════════════════════════════════════════════════════════════════════════
// Piezas compartidas del namespace `agentes` (paneles de los agentes del cliente, P4/P5 del plan i18n).
//
// Las vistas de servidor son funciones síncronas que las pruebas renderizan con `renderToStaticMarkup`: no pueden esperar a
// `getT`. Por eso reciben el traductor por prop (`tr`, lo arma la página con `getT('agentes')`) y, sin él, hablan español.
// Los componentes de cliente usan `useT('agentes', agentesEs)` directamente (el layout de /dashboard/agentes trae el proveedor).
// ═══════════════════════════════════════════════════════════════════════════

export type TrAgentes = Traductor<DiccionarioDe<'agentes'>>;
export type TAgentes = TrAgentes['t'];

/** El traductor en español: lo que dicen los paneles sin idioma elegido (y lo que usan las pruebas de render). */
export const TR_ES: TrAgentes = crearTraductor<DiccionarioDe<'agentes'>>('es', agentesEs, agentesEs);

const MARCA = /(\{[A-Za-z_]\w*\})/;

/**
 * Una frase con trozos que no son texto (negritas, enlaces, cifras con formato): la frase completa es UNA clave con
 * `{marcadores}` y aquí solo se parte donde están. Nunca se concatena texto traducido.
 */
export function rico(texto: string, nodos: Readonly<Record<string, ReactNode>>): ReactNode[] {
  return texto.split(MARCA).map((pieza, i) => {
    const m = /^\{([A-Za-z_]\w*)\}$/.exec(pieza);
    return m && m[1] in nodos ? <Fragment key={i}>{nodos[m[1]]}</Fragment> : <Fragment key={i}>{pieza}</Fragment>;
  });
}

/** Sello de procedencia «<Fuente> · leído <fecha>» (como `selloHoy`, pero en el idioma activo). */
export function selloHoyTr(tr: TrAgentes, fuente: string): string {
  return tr.t('comun.sello_leido', { fuente, fecha: fechaMx(hoyMx(new Date(ahoraMs())), tr.idioma) });
}

/** Los días ISO (1 = lunes) como los lee una persona de tráfico: «L–S» o «L, X, V» (en inglés «M–S», «M, W, F»). */
export function rotuloDiasTr(dias: number[], t: TAgentes): string {
  const corto = (d: number) => t(`comun.dia_${d}` as 'comun.dia_1');
  const contiguos = dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
  if (contiguos && dias.length > 2) return `${corto(dias[0])}–${corto(dias[dias.length - 1])}`;
  return dias.map(corto).join(', ');
}
