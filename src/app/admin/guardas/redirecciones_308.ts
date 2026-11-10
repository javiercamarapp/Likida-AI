/**
 * Registro de las redirecciones PERMANENTES (308) de /admin: dirección vieja -> dirección nueva. Vacío hasta la Fase 1, que mueve
 * pantallas de lugar. Cada entrada debe tener su stub (`page.tsx` en la dirección vieja que llame `redirigirPermanente(<nueva>, searchParams)`),
 * y la guarda `redirecciones_308.test.ts` lo comprueba en las dos direcciones.
 */
export const REDIRECCIONES_308: Readonly<Record<string, string>> = {};
