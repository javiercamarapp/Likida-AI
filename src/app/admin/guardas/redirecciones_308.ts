/**
 * Registro de las redirecciones PERMANENTES (308) de /admin: dirección vieja -> dirección nueva. Cada entrada debe tener su stub
 * (`page.tsx` en la dirección vieja que llame `redirigirPermanente(<nueva>, searchParams)`), y la guarda `redirecciones_308.test.ts`
 * lo comprueba en las dos direcciones. El stub se retira cuando no queden enlaces entrantes en código ni runbooks y los registros de
 * acceso de Vercel no muestren visitas (plan maestro 3.3 regla 7). Fase 1: los cuatro de pantallas sin función; Fase 2: `ejecutivo` y
 * `analitica` (su cifra vive en el Resumen).
 */
export const REDIRECCIONES_308: Readonly<Record<string, string>> = {
  '/admin/playground': '/admin/agentes',
  '/admin/conocimiento-rag': '/admin',
  '/admin/comunicacion': '/admin/marketing',
  '/admin/configuracion': '/admin/flotas',
  '/admin/ejecutivo': '/admin',
  '/admin/analitica': '/admin',
};
