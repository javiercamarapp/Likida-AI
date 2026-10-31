/* eslint-disable security/detect-non-literal-fs-filename -- el arnés escribe en una ruta de salida propia */
// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS L5 («Pregunta a tus datos»): el chrome v2 REAL (sidebar, topbar, barra inferior) con un punto de montaje donde
// `capturar-chat.mjs` monta el ChatFlota VERDADERO (empaquetado con vite) y lo maneja con un `fetch` de mentira que transmite
// NDJSON. Datos 100 % sintéticos. Uso: UI2_OUT=<dir> npx vitest run --config scripts/ui2-captura/vitest.config.mts l5
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('el arnés no toca la base'); } }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard/chat',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

const { default: Chrome } = await import('@/app/dashboard/shell/chrome-v2');
import { exigirV2Html } from './exigir_v2';
import { USUARIO } from './fixtures/logistica_mx';

const OUT = process.env.UI2_OUT ?? path.join(homedir(), 'likida-loop/cierre100/arnes-l5');

describe('L5', () => {
  it('renderiza el chrome v2 con el punto de montaje del chat', () => {
    mkdirSync(path.join(OUT, 'vistas'), { recursive: true });
    const html = renderToStaticMarkup(
      <Chrome nombre={USUARIO.nombre} rol="flota_admin" cerrarSesion={async () => {}}>
        <main className="rv-chat-pagina"><div id="montaje" className="rv-chat-pagina" /></main>
      </Chrome>,
    );
    exigirV2Html(html, 'l5-chat');
    writeFileSync(path.join(OUT, 'vistas', 'l5-chat.html'), html);
  });
});
