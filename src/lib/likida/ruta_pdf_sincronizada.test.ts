// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 5 — "el cableado en general: ninguna prueba verifica que el motor esté
// conectado al PDF, que el PDF esté conectado al envío, ni que el envío normalice
// el destinatario". Este archivo cubre la costura que quedaba suelta entre las
// dos últimas.
//
// LA RUTA DEL EJEMPLAR DEL OPERADOR ESTÁ ESCRITA A MANO EN DOS ARCHIVOS:
//
//   tools.ts      SUBE     a  `${ctx.tenantId}/${ctx.viajeId}-operador.pdf`
//   processor.ts  DESCARGA de `${op.tenantId}/${viajeId}-operador.pdf`
//
// Son dos literales que nadie obliga a coincidir. Si alguien renombra el de
// `tools.ts` —un refactor inocente, exactamente como el que reintrodujo el bug de
// hoy—, `createSignedUrl` apunta a un objeto que no existe, el chofer no recibe
// su liquidación, y el único rastro es una línea de `pdf.no_entregado` en el log.
// La liquidación YA quedó cerrada en la base, así que no hay reintento: es el
// mismo modo de falla que costó veinte minutos el 28-jul-2026 (el PDF generado y
// subido, comprobado en el bucket, y el operador sin nada).
//
// TypeScript no puede atrapar esto: los dos son plantillas de string. Se usa la
// técnica que ya vive en la casa —`presupuesto.test.ts:77-84` lee `route.ts` como
// TEXTO y compara el `maxDuration` real contra el presupuesto, y
// `etiquetas_sincronizadas.test.ts` hace lo mismo con los mapas de etiquetas—,
// que es justo la que le faltaba al cableado del dinero.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const leer = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/**
 * Las plantillas de ruta de storage que aparecen en un fuente, con los nombres de
 * variable BORRADOS: `${ctx.tenantId}/${ctx.viajeId}-operador.pdf` y
 * `${op.tenantId}/${viajeId}-operador.pdf` son la misma ruta escrita por dos
 * personas distintas, y eso es lo que hay que comparar.
 */
function rutasDePdf(src: string): string[] {
  return [...src.matchAll(/`([^`]*\.pdf)`/g)]
    .map((m) => m[1].replace(/\$\{[^}]*\}/g, '{}'))
    .filter((r, i, a) => a.indexOf(r) === i);
}

const TOOLS = leer('./tools.ts');
const PROCESSOR = leer('./processor.ts');

describe('la ruta del PDF del operador es la MISMA donde se sube y donde se lee', () => {
  // CONTROL: si el extractor dejara de encontrar rutas, todo lo de abajo pasaría
  // por vacío.
  it('los dos archivos siguen construyendo rutas de PDF a mano', () => {
    expect(rutasDePdf(TOOLS).length, 'tools.ts ya no arma rutas de PDF').toBeGreaterThan(0);
    expect(rutasDePdf(PROCESSOR).length, 'processor.ts ya no arma rutas de PDF').toBeGreaterThan(0);
  });

  it('la que `processor.ts` descarga es una de las que `tools.ts` sube', () => {
    const suben = rutasDePdf(TOOLS);
    const descargan = rutasDePdf(PROCESSOR);
    for (const r of descargan) {
      expect(suben, `processor.ts lee "${r}" y tools.ts no sube ninguna ruta con esa forma`).toContain(r);
    }
  });

  it('y es el ejemplar del OPERADOR, no el completo del contralor', () => {
    // Si `processor.ts` pasara a leer `{}/{}.pdf`, el chofer recibiría por
    // WhatsApp el ejemplar con los veredictos que `resumen.ts` le oculta — el
    // hallazgo ALTO de la ronda 4 por otra puerta.
    expect(rutasDePdf(PROCESSOR)).toContain('{}/{}-operador.pdf');
    expect(rutasDePdf(PROCESSOR)).not.toContain('{}/{}.pdf');
  });

  it('`tools.ts` sube los DOS ejemplares en rutas distintas', () => {
    const suben = rutasDePdf(TOOLS);
    expect(suben).toContain('{}/{}.pdf');
    expect(suben).toContain('{}/{}-operador.pdf');
  });
});
