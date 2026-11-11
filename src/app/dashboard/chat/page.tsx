import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import { CATALOGO_CONSULTA } from './respuestas';
import { getKpis, getAcreditables, type DashboardKpis, type Acreditables } from '@/lib/likida/analytics';
import { ventanaLitrosElegibles } from '@/lib/likida/fiscal';
import { hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { AvisoSinFlota } from '../sin-flota';
import ChatFlota from '../chat';
import './chat-pagina.css';

export const dynamic = 'force-dynamic';

/**
 * Pregunta a tus datos (título igual al del menú, al de la pestaña y al h1 accesible) — LA PRIMERA página reconstruida tras el borrado del
 * 10-ago-2026, pedida explícita el 12-ago: una página hero propia con el
 * logo de Likida. La composición hero ya vivía en `ChatFlota` (variante
 * 'hero', sobrevivió al borrado porque el componente lo usa también el rail).
 *
 * REGLA DE SEGURIDAD HEREDADA (inventario §12, corregida en su momento):
 * `getKpis`/`getAcreditables` se piden DESPUÉS de `puedeVerArea(rol,
 * 'dinero')` — antes de ese chequeo, un encargado podía leer cifras de
 * dinero por esta pantalla aunque el resto del panel se las negara.
 *
 * H13 (auditoría 24): era la única pantalla del panel que se tragaba
 * `tenantNombre` y `tenantExiste`. Un superadmin le preguntaba a la IA sobre
 * «mi flota» sin nada en pantalla que dijera CUÁL —la misma cinta que el
 * Resumen sí pinta—, y con `DEMO_TENANT_ID` apuntando a una flota borrada la
 * IA contestaba con los ceros de una flota inexistente como si fueran
 * medición. Las dos cosas ya se resolvían aquí arriba; solo faltaba
 * enseñarlas.
 */
export default async function PaginaChat({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol, tenantNombre, tenantExiste } = await resolverTenantEfectivo('/dashboard/chat', sp);

  if (!puedeVerArea(rol, 'dinero')) redirect('/dashboard');

  // FE-8 (auditoría 24): misma ventana que combustible-casetas/page.tsx e
  // inicio-contador.tsx — antes esta pantalla leía el HISTÓRICO completo
  // mientras las otras dos ya medían por ejercicio; el analista podía
  // contestar con una cifra de "litros elegibles" que no coincidía con
  // ninguna otra pantalla del panel.
  const vl = ventanaLitrosElegibles(hoyMx(new Date(ahoraMs())));
  // Flota con perfil (cinco_agentes, 11-nov): el chat se abre con lo de sus agentes. Lo fiscal (acreditables) NI SE LEE ni se ofrece
  // como tema: las respuestas rápidas del navegador no pueden ser la puerta trasera de lo que la API ya recorta.
  const perfil = await perfilDeTenant(tenantId);
  const [kpis, acred] = await Promise.all([
    getKpis(tenantId).catch((): DashboardKpis | null => null),
    perfil ? Promise.resolve<Acreditables | null>(null) : getAcreditables(tenantId, vl.dias).catch((): Acreditables | null => null),
  ]);
  const temas = perfil ? CATALOGO_CONSULTA.filter((t) => t.categoria !== 'Fiscal y acreditables') : undefined;

  return (
    // `rv-chat-pagina`: la pantalla del agente llena el alto del marco SIN scroll de página (el hilo scrollea por dentro);
    // el CSS (ui-v2/chat.css) lo detecta con :has() para quitarle el relleno y el scroll a `.rv-contenido`.
    <main className="rv-chat-pagina">
      {/* ARRIBA de la conversación, como en el Resumen: una respuesta de la IA sobre una flota que no existe no es un dato del negocio. */}
      {!tenantExiste && <div className="rv-chat-pagina__aviso"><AvisoSinFlota tenantId={tenantId} /></div>}
      <ChatFlota
        kpis={kpis}
        acred={acred}
        temas={temas}
        cabecera={tenantNombre ? (
          <span className="rv-chat__cinta">viendo como superadmin · {tenantNombre}</span>
        ) : undefined}
      />
    </main>
  );
}

export const metadata: Metadata = { title: 'Pregunta a tus datos' };
