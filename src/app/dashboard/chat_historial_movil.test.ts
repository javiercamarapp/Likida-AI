import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · H12 (resuelto en L3 con el Drawer del motor único) — el cajón de "Historial" del chat median 352px FIJOS,
// también en un teléfono: con `historialAbierto`, el panel es hermano flex
// del hilo de conversación, así que en una pantalla de 375px esos 352px se
// comían casi todo el ancho y dejaban el chat comprimido a unos pocos
// píxeles, ilegible — no un cajón que se pueda cerrar cómodamente ni un hilo
// usable al mismo tiempo.
//
// `chat.tsx` es un client component con hooks de Next (`useSearchParams`) y
// efectos con `fetch`: montarlo de verdad en esta suite exige simular todo
// ese entorno para probar una sola clase CSS. Se prueba la fuente
// directamente, como ya hace el propio informe de auditoría para FE-1
// ("test que lee next.config.ts…") — el contrato que importa es que el
// panel, CUANDO ESTÁ ABIERTO, declare el override de ancho completo bajo
// `lg`, y que se conserve la animación de 352px para escritorio.
// ═══════════════════════════════════════════════════════════════════════════

const fuente = readFileSync(path.join(__dirname, 'chat.tsx'), 'utf8');

describe('chat.tsx: el historial en móvil es un Drawer del motor único (L3)', () => {
  it('bajo `lg` monta el Drawer con el estado historialAbierto y su cierre; no queda ninguna cortina fixed a mano', () => {
    expect(fuente).toMatch(/<Drawer abierto=\{historialAbierto\} onCerrar=\{\(\) => setHistorialAbierto\(false\)\} titulo="Historial">/);
    expect(fuente).not.toMatch(/max-lg:!fixed|max-lg:z-40|fixed inset-0/);
    expect(fuente).toMatch(/\(max-width: 1023\.98px\)/); // el mismo corte `lg` de antes
  });

  it('el contenido del historial se define UNA vez y la X propia de la columna no se duplica en la hoja', () => {
    expect(fuente.match(/const cuerpoHistorial = /g)?.length).toBe(1);
    expect(fuente).toMatch(/\{!movil && <button type="button" aria-label="Cerrar historial"/);
  });

  it('el ancho animado de escritorio (352px) sigue intacto y la columna cerrada es inerte', () => {
    expect(fuente).toMatch(/width:\s*historialAbierto\s*\?\s*352\s*:\s*0/);
    expect(fuente).toMatch(/inert=\{!historialAbierto\}/);
  });
});
