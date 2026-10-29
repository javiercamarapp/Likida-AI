// Renderiza lo que el producto muestra HOY mientras una pantalla del panel carga: el layout (chrome) + `loading.tsx`
// (`app/cargando.tsx`, el logo respirando dentro del contenido). Alimenta el criterio c8 (carga por fotograma).
// Salida: $UI2_TRABAJO/x/vistas/carga-v2.html  (por omisión ~/likida-loop/frontend-plan/rovaq-method/.trabajo/x)
// Uso: npx vitest run --config scripts/ui2-calidad/vitest.config.mts   (con ~/likida-loop/heavy.sh)
import { describe, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

const { default: DashboardChromeV2 } = await import('@/app/dashboard/shell/chrome-v2');
const { default: Cargando } = await import('@/app/cargando');

const TRABAJO = process.env.UI2_TRABAJO ?? path.join(homedir(), 'likida-loop/frontend-plan/rovaq-method/.trabajo');

describe('carga actual del panel (para scripts/ui2-calidad)', () => {
  it('renderiza chrome v2 + Cargando', () => {
    const dir = path.join(TRABAJO, 'x', 'vistas');
    mkdirSync(dir, { recursive: true });
    const html = renderToStaticMarkup(
      <DashboardChromeV2 nombre="Ana Prueba" rol="flota_admin" perfil="cinco_agentes" cerrarSesion={async () => {}}>
        <Cargando />
      </DashboardChromeV2>,
    );
    writeFileSync(path.join(dir, 'carga-v2.html'), html);
  });
});
