import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { PanelRevision } from './revision-panel';
import type { RevisionDetalle } from '@/lib/likida/revision';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, BLOQUEANTE 6 — la firma humana llega a la pantalla.
//
// El hueco medido: NI UN `update` sobre `liquidacion` en toda la app. El
// contralor leía el PDF y decidía en Excel. Lo que se prueba aquí es que la
// pantalla no vuelva a mentir en ninguno de los tres bordes:
//   · una ya firmada dice QUIÉN y CUÁNDO (y una que cuadró sola no finge
//     que la firmó alguien);
//   · el rol que no firma ve por qué no, no un botón que rebota;
//   · rechazar avisa que el motivo se lo va a leer el chofer.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const estado = (sobre: Partial<RevisionDetalle> = {}): RevisionDetalle => ({
  revision: 'pendiente', revisadaPor: null, revisadaEn: null, motivo: null, ajustes: [],
  viajeEstatus: 'liquidado', firmable: true, ...sobre,
});
const GASTOS = [{ id: 'g-1', etiqueta: 'Diésel', monto: 800 }];
const pintar = (e: RevisionDetalle, accion: unknown = async () => null) => renderToStaticMarkup(
  <PanelRevision estado={e} gastos={GASTOS} accion={accion as never} folio="V-1041" />,
);

describe('PanelRevision', () => {
  it('pendiente: ofrece las tres decisiones y el motivo, con el botón que se apaga al enviar', () => {
    const html = pintar(estado());
    expect(html).toContain('Aprobar');
    expect(html).toContain('Ajustar montos');
    expect(html).toContain('Rechazar');
    expect(html).toContain('name="motivo"');
    expect(html).toContain('name="accion"');
  });

  it('la que cuadró sola NO dice que la firmó alguien, y sigue siendo corregible', () => {
    const html = pintar(estado({
      revision: 'aprobada', revisadaPor: null, revisadaEn: '2026-08-25T18:00:00+00:00',
      motivo: 'Cuadró sola: sin diferencias', firmable: true,
    }));
    expect(html).toContain('cuadró sola');
    expect(html).not.toContain('la firmó ');
    expect(html).toContain('todavía la puedes corregir');
  });

  it('la firmada por una persona dice quién y cuándo, y ya no se vuelve a firmar', () => {
    const html = pintar(estado({
      revision: 'ajustada', revisadaPor: 'contralor@flota.mx', revisadaEn: '2026-08-25T18:00:00+00:00',
      motivo: 'el ticket dice 8,000', firmable: false,
      ajustes: [{ gastoId: 'g-1', concepto: 'diesel', montoAnterior: 800, montoNuevo: 8000 }],
    }));
    expect(html).toContain('contralor@flota.mx');
    expect(html).toContain('el ticket dice 8,000');
    // La corrección de WA-3, visible: de dónde a dónde se movió la cifra.
    expect(html).toContain('$800.00');
    expect(html).toContain('$8,000.00');
    expect(html).not.toContain('name="accion"');
  });

  it('rechazada: no se firma otra vez y se dice qué sigue', () => {
    const html = pintar(estado({
      revision: 'rechazada', revisadaPor: 'a@b.mx', revisadaEn: '2026-08-25T18:00:00+00:00',
      motivo: 'faltan casetas', firmable: false,
    }));
    expect(html).not.toContain('name="accion"');
    expect(html).toContain('volvió a cuadre');
  });

  it('el rol que no firma ve POR QUÉ, no un botón que va a rebotar', () => {
    const html = pintar(estado(), null);
    expect(html).not.toContain('name="accion"');
    expect(html).toContain('Tu rol no firma liquidaciones');
  });

  // ── FE-M3 (auditoría 28) ──────────────────────────────────────────────
  // Los tres radios de la firma son `<input class="sr-only">`: sin gancho de
  // foco visible, `→`/Tab mueven la selección a ciegas y Enter firma la
  // acción equivocada — el único control irreversible del producto (WCAG
  // 2.4.7). El arreglo es una regla CSS aditiva en globals.css, así que la
  // prueba tiene DOS mitades: el markup sigue teniendo el gancho que la
  // regla necesita (input.sr-only hijo DIRECTO del label), y la regla existe.
  it('FE-M3: el radio sr-only es hijo directo del label (gancho del foco visible)', () => {
    const html = pintar(estado());
    // Si el input dejara de ser el primer hijo del <label>, el selector
    // `label:has(> input.sr-only:focus-visible)` de globals.css deja de
    // aplicar EN SILENCIO — de ahí la aserción sobre el orden exacto.
    expect(html).toMatch(/<label[^>]*>\s*<input type="radio"[^>]*class="sr-only"/);
  });

  it('FE-M3: globals.css pinta el foco visible del label cuando el radio interno lo tiene', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- lee el globals.css HERMANO de esta prueba, resuelto de import.meta.url en tiempo de prueba; no viene de entrada de usuario.
    const css = readFileSync(new URL('../../globals.css', import.meta.url), 'utf8');
    expect(css).toMatch(/label:has\(>\s*input\.sr-only:focus-visible\)\s*\{[^}]*outline:\s*3px solid/);
  });

  // ── FE-B3 (auditoría 28) ──────────────────────────────────────────────
  // El comentario de cabecera decía de AJUSTAR «NO vuelve a cuadrar», pero
  // `revision.ts` SÍ recalcula el cuadre y regenera el PDF (mig. 0306) —el
  // comentario documentaba lo contrario del código.
  it('FE-B3: el comentario de cabecera ya no dice que Ajustar no vuelve a cuadrar', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- lee el revision-panel.tsx HERMANO de esta prueba, resuelto de import.meta.url en tiempo de prueba; no viene de entrada de usuario.
    const fuente = readFileSync(new URL('./revision-panel.tsx', import.meta.url), 'utf8');
    expect(fuente).not.toContain('NO vuelve a cuadrar');
    expect(fuente).toMatch(/RECALCULA el cuadre/);
  });
});

describe('A37-P-01: la disputa de monto del operador llega a la oficina', () => {
  const DISPUTA = { montoLeido: 800, por: 'operador-1', dijo: 'son 8000', en: '2026-10-20T10:00:00Z' };
  const conDisputa = [{ id: 'g-1', etiqueta: 'Diésel', monto: 800, disputa: DISPUTA }];

  it('sin disputa no pinta el aviso', () => {
    expect(pintar(estado())).not.toContain('El operador dice');
  });

  it('con la liquidación vigente avisa y manda a «Ajustar montos» (no ofrece la corrección directa)', () => {
    const html = renderToStaticMarkup(
      <PanelRevision estado={estado()} gastos={conDisputa} accion={(async () => null) as never} folio="V-1041"
        corregir={(async () => null) as never} />,
    );
    expect(html).toContain('El operador dice que este monto está mal');
    expect(html).toContain('son 8000');
    expect(html).toContain('$800.00');
    expect(html).toContain('Ajustar montos');
    expect(html).not.toContain('Corregir monto');
  });

  it('rechazada (el viaje volvió a cuadre) ofrece corregir el monto directo; sin permiso, no', () => {
    const rechazada = estado({ revision: 'rechazada', firmable: false });
    const con = renderToStaticMarkup(
      <PanelRevision estado={rechazada} gastos={conDisputa} accion={null} folio="V-1041" corregir={(async () => null) as never} />,
    );
    expect(con).toContain('Corregir monto');
    expect(con).toContain('name="gastoId"');
    const sin = renderToStaticMarkup(
      <PanelRevision estado={rechazada} gastos={conDisputa} accion={null} folio="V-1041" corregir={null} />,
    );
    expect(sin).toContain('El operador dice');
    expect(sin).not.toContain('Corregir monto');
  });

  it('el texto libre del operador se pinta escapado', () => {
    const html = renderToStaticMarkup(
      <PanelRevision estado={estado()} gastos={[{ ...conDisputa[0], disputa: { ...DISPUTA, dijo: '<img src=x onerror=alert(1)>' } }]}
        accion={null} folio="V-1" />,
    );
    expect(html).not.toContain('<img');
  });
});
