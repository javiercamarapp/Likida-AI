// ═══════════════════════════════════════════════════════════════════════════
// PREVIEW TEMPORAL — SE BORRA AL TERMINAR. No es parte del producto.
//
// Las pantallas del panel fiscal viven detrás de sesión, así que para MIRAR el
// render (CLAUDE.md: "medir no sustituye a mirar") se monta este preview que
// importa los componentes REALES —`Contenido` de cada page.tsx— con el tenant
// de la demo. Datos reales de Supabase, no fixtures: un preview con datos
// inventados verifica el fixture.
//
// NO copia una sola línea de JSX. Si algo se ve mal aquí, está mal en la
// pantalla de verdad.
// ═══════════════════════════════════════════════════════════════════════════
import { Contenido as PanelFiscal } from '../dashboard/contador/page';
import { Contenido as Deducciones } from '../dashboard/contador/deducciones/page';
import { Contenido as Cfdi } from '../dashboard/contador/cfdi/page';
import { Contenido as Combustible } from '../dashboard/contador/combustible/page';
import { Contenido as Retenciones } from '../dashboard/contador/retenciones/page';
import { Contenido as Liquidaciones } from '../dashboard/contador/liquidaciones/page';

export const dynamic = 'force-dynamic';

const TENANT = process.env.DEMO_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';

export default async function Preview({
  searchParams,
}: {
  searchParams: Promise<{ v?: string; p?: string; f?: string }>;
}) {
  const sp = await searchParams;
  const p = sp.p;

  const cual = sp.v ?? 'panel';
  const vista =
    cual === 'deducciones' ? <Deducciones tenantId={TENANT} sp={{ p }} />
    : cual === 'cfdi' ? <Cfdi tenantId={TENANT} sp={{ p, f: sp.f }} rol="contador" />
    : cual === 'combustible' ? <Combustible tenantId={TENANT} sp={{ p }} />
    : cual === 'retenciones' ? <Retenciones tenantId={TENANT} sp={{ p }} />
    : cual === 'liquidaciones' ? <Liquidaciones tenantId={TENANT} sp={{ p }} />
    : <PanelFiscal tenantId={TENANT} sp={{ p }} />;

  return (
    <div style={{ background: 'var(--canvas)', minHeight: '100vh' }}>
      <div className="mx-auto max-w-[1200px] p-6">{vista}</div>
    </div>
  );
}
