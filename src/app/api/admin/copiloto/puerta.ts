// La puerta compartida de las rutas del copiloto — vive FUERA de route.ts
// porque Next valida los exports de una ruta (misma razón que
// api/dashboard/chat/validacion.ts) y porque ahora son TRES rutas con la
// misma puerta: el chat/acciones, la lista del historial y una conversación.
// Las rutas /api no pasan por el layout de /admin: cada una re-chequea aquí.
//
/** Sin sesión: 401. Otro rol: 403. Con el segundo factor exigido (SEG-3) y
 *  sin verificar: 403 (auditoría 25, línea 166, REINCIDENTE — el chequeo
 *  vive ahora en `@/lib/auth/api-superadmin`, compartido con
 *  mapa-prospectos/ y qa/). Ninguna respuesta dice qué hay detrás. */
export { sesionSuperadmin } from '@/lib/auth/api-superadmin';
