import { NextResponse } from 'next/server';
import { sesionSuperadmin } from '@/lib/auth/api-superadmin';
import { vieneDeNuestroSitio } from '@/lib/auth/csrf';
import { esUuidValido } from '@/lib/likida/intake/cfdi';
import { exportarFlota, offboardingActivo } from '@/lib/likida/offboarding/exportar';
import { registrarAccesoSuperadmin } from '@/lib/seguridad/acceso_superadmin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTACIÓN DE UNA FLOTA (offboarding) — F9, CT-DAT-16. Solo superadmin (con su segundo factor), mismo sitio, y tras la palanca
// `LIKIDA_OFFBOARDING_EXPORTACION=activo` (apagada por omisión; 404 mientras lo esté, para no anunciar la ruta). Devuelve el paquete
// (archivos JSON Lines + manifiesto + huella) y deja la constancia en `tenant_exportacion` (0998). NO borra ni anonimiza nada.
// El tope por tabla (50,000 filas) evita lecturas sin fin; si una tabla lo rebasa, el paquete sale incompleto y se dice, en vez de
// entregarse a medias en silencio. OJO: la respuesta es un solo JSON y una flota mediana puede rebasar el límite de cuerpo de respuesta de
// Vercel (4.5 MB). Antes de encender la palanca en producción hay que entregar el paquete por Storage con URL firmada o por streaming.
// ═══════════════════════════════════════════════════════════════════════════

export async function POST(req: Request) {
  if (!offboardingActivo()) return new NextResponse(null, { status: 404 });
  const { error: puerta, sesion } = await sesionSuperadmin();
  if (!sesion) return puerta;
  if (!vieneDeNuestroSitio(req)) return NextResponse.json({ error: 'Petición de otro sitio.' }, { status: 403 });

  let tenantId = '';
  try {
    const cuerpo = (await req.json()) as { tenantId?: unknown };
    tenantId = typeof cuerpo.tenantId === 'string' ? cuerpo.tenantId : '';
  } catch { /* cuerpo ilegible: cae a la validación */ }
  if (!esUuidValido(tenantId)) return NextResponse.json({ error: 'tenantId inválido.' }, { status: 400 });

  try {
    const r = await exportarFlota(tenantId, sesion.userId);
    void registrarAccesoSuperadmin({
      actor: sesion.userId, tenantId, tipo: 'descarga', ruta: '/api/admin/offboarding', detalle: { completo: r.ok },
    });
    if (!r.ok) return NextResponse.json({ error: r.motivo, manifiesto: r.paquete?.manifiesto ?? null }, { status: 409 });
    return NextResponse.json({
      exportacionId: r.exportacionId,
      huellaManifiesto: r.paquete.huellaManifiesto,
      manifiestoJson: r.paquete.manifiestoJson,
      archivos: r.paquete.archivos.map((a) => ({ nombre: a.nombre, contenido: a.contenido, sha256: a.sha256, filas: a.filas })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    logger.error('offboarding.fallo', { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'No se pudo generar la exportación.' }, { status: 500 });
  }
}
