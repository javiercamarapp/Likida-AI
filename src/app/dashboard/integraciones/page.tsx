import { redirect } from 'next/navigation';
import { sufijoTenant } from '../sufijo';

// ═══════════════════════════════════════════════════════════════════════════
// LA PANTALLA GEMELA, FUSIONADA (agosto-2026).
//
// `/dashboard/integraciones` y `/dashboard/conexiones` contestaban la misma
// pregunta —«¿con qué está conectada mi flota?»— con dos consultas distintas
// contra la misma tabla y dos textos que podían contradecirse. Su contenido
// vive ahora como una sección de Conexiones (`seccion-integraciones.tsx`).
//
// Queda el REDIRECT y no un 404: la ruta lleva meses en el sidebar, está en
// correos y en documentos, y un enlace guardado tiene que seguir llevando a
// donde está la información. Se conserva el sufijo del superadmin (`?tenant=`,
// `?vista=`, `?rol=`) o el salto lo sacaría de la flota que estaba mirando.
//
// El gateo NO se repite aquí: `puedeVerRuta` decide en el destino, que es
// `administracion` igual que ésta. Comprobarlo dos veces solo abriría la
// puerta a que las dos comprobaciones se separen.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

export default async function PaginaIntegraciones({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  redirect(`/dashboard/conexiones${sufijoTenant(await searchParams)}`);
}
