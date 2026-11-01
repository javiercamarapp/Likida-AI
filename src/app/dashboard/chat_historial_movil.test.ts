/* eslint-disable security/detect-non-literal-fs-filename -- lee fuentes del propio repo con rutas fijas */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · H12 (resuelto en L3 con el Drawer del motor único; reubicado en L5 al partir `chat.tsx` en `chat/*`) — el cajón
// de «Historial» del chat medía 352 px FIJOS también en un teléfono: con el panel abierto, en una pantalla de 375 px esos 352 px se
// comían casi todo el ancho y dejaban el chat comprimido a unos pocos píxeles.
//
// Los componentes son client components con hooks de Next y efectos con `fetch`: montarlos de verdad en esta suite exige simular todo ese
// entorno para probar una sola clase CSS. Se prueba la FUENTE directamente (como hace el informe de auditoría para FE-1): bajo `lg` el
// historial es un Drawer del motor único; sobre `lg`, la columna en flujo de 352 px que anima su ancho y cerrada es inerte.
// ═══════════════════════════════════════════════════════════════════════════

const leer = (rel: string) => readFileSync(path.join(__dirname, rel), 'utf8');
const historial = leer('chat/historial.tsx');
const flota = leer('chat/chat-flota.tsx');
const css = readFileSync(path.join(__dirname, '../ui-v2/chat.css'), 'utf8');

describe('chat: el historial en móvil es un Drawer del motor único (L3)', () => {
  it('bajo `lg` monta el Drawer con su estado y su cierre; no queda ninguna cortina fixed a mano', () => {
    expect(historial).toMatch(/<Drawer abierto=\{abierto\} onCerrar=\{onCerrar\} titulo="Historial">/);
    expect(historial).not.toMatch(/max-lg:!fixed|max-lg:z-40|fixed inset-0/);
    expect(flota).toMatch(/\(max-width: 1023\.98px\)/); // el mismo corte `lg` de antes
  });

  it('el contenido del historial se define UNA vez y la X propia de la columna no se duplica en la hoja', () => {
    expect(historial.match(/function CuerpoHistorial/g)?.length).toBe(1);
    expect(historial).toMatch(/\{escritorio && \(\s*<button type="button" aria-label="Cerrar historial"/);
    expect(historial).toMatch(/escritorio=\{false\}/);
  });

  it('el ancho animado de escritorio (352 px) sigue intacto, por CLASE y con el token de movimiento, y la columna cerrada es inerte', () => {
    expect(css).toMatch(/\.rv-chat__hist\[data-abierto="true"\]\s*\{\s*width:\s*352px/);
    expect(css).toMatch(/\.rv-chat__hist\s*\{\s*transition:\s*width var\(--chat-hist\) var\(--ui-ease\)/);
    expect(historial).toMatch(/inert=\{!abierto\}/);
  });
});

describe('chat: CSP — cero `style=` en los componentes del chat', () => {
  it.each(['chat-flota', 'composer', 'historial', 'mensajes', 'bloques', 'traza', 'sugerencias', 'marca'])('%s.tsx no usa style=', (n) => {
    expect(leer(`chat/${n}.tsx`)).not.toMatch(/\bstyle=\{/);
  });
});
