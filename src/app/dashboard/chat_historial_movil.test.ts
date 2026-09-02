import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · H12 — el cajón de "Historial" del chat median 352px FIJOS,
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

describe('chat.tsx — el historial ocupa la pantalla completa en móvil', () => {
  it('declara un override de ancho completo bajo `lg` SOLO cuando el historial está abierto', () => {
    expect(fuente).toMatch(/historialAbierto\s*\?\s*'max-lg:!fixed[^']*max-lg:!w-full[^']*'\s*:\s*''/);
  });

  it('el contenedor interior también se estira a ancho completo bajo `lg`', () => {
    const idx = fuente.indexOf('w-[320px] mx-4 h-full rounded-2xl hairline flex flex-col');
    expect(idx, 'el contenedor interior del historial debe existir').toBeGreaterThan(-1);
    const linea = fuente.slice(idx, fuente.indexOf('"', idx));
    expect(linea).toMatch(/max-lg:!w-full/);
  });

  it('el ancho animado de escritorio (352px) sigue intacto — el arreglo no lo reemplaza', () => {
    expect(fuente).toMatch(/width:\s*historialAbierto\s*\?\s*352\s*:\s*0/);
  });
});
