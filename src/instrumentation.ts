// Hook de arranque de Next.js (se ejecuta una vez al iniciar el servidor).
// 2.1: verifica que las migraciones críticas (0005) estén aplicadas y avisa
// ruidoso si faltan. Aquí también se cablearía Sentry (ME-9, post-demo).

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return; // solo runtime Node del servidor
  const { verificarMigracionesCriticas } = await import('@/lib/cuadra/startup');
  await verificarMigracionesCriticas();
}
