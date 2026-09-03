// La puerta de /api/admin/mapa-prospectos — mismo patrón que qa/puerta.ts:
// las rutas /api no pasan por el layout de /admin, así que esta familia
// re-chequea sesión aquí. Detrás hay la cartera comercial completa (829
// prospectos con teléfonos y decisores) — sin sesión: 401; otro rol: 403; con
// el segundo factor exigido (SEG-3) y sin verificar: 403 (auditoría 25, línea
// 166, REINCIDENTE — el chequeo vive ahora en `@/lib/auth/api-superadmin`,
// compartido con qa/ y copiloto/, para que dejen de existir tres copias que
// se desalinean de a una).
export { sesionSuperadmin } from '@/lib/auth/api-superadmin';
