// La puerta de las rutas /api/admin/qa/* — mismo patrón que
// api/admin/copiloto/puerta.ts: las rutas /api NO pasan por el layout de
// /admin (su requireSuperadmin() no las cubre), así que cada familia de rutas
// re-chequea aquí. Detrás hay lecturas y ESCRITURAS con service_role más
// gasto real de modelo por corrida — sin sesión: 401; otro rol: 403; con el
// segundo factor exigido (SEG-3) y sin verificar: 403 (auditoría 25, línea
// 166, REINCIDENTE — el chequeo vive ahora en `@/lib/auth/api-superadmin`,
// compartido con mapa-prospectos/ y copiloto/); ninguna respuesta dice qué
// hay detrás.
export { sesionSuperadmin } from '@/lib/auth/api-superadmin';
