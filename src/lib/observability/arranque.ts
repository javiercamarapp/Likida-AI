// ═══════════════════════════════════════════════════════════════════════════
// LO QUE EL ARRANQUE TIENE QUE DECIR EN VOZ ALTA
//
// Este archivo cubre una clase concreta de fallo, no "validar el entorno": las
// variables cuya ausencia **no rompe nada**. Las que rompen se descubren solas —
// sin `SUPABASE_SERVICE_ROLE_KEY` la primera consulta explota y alguien se
// entera. Las de aquí son peores porque el sistema arranca, atiende, y contesta
// mal:
//
//   · `DEMO_TENANT_ID` ausente → el panel cae al tenant de `supabase/seed.sql` y
//     pinta CERO liquidaciones, sin un solo log. En el demo del 6 de agosto eso
//     se lee como "el producto no guardó nada". Es el caso de manual del rubro.
//   · `DASHBOARD_PASSCODE` ausente → `proxy.ts` no bloquea `/dashboard`: el panel
//     del contralor queda abierto y tampoco avisa.
//   · `CUADRA_WHATSAPP_MSG_USD` ausente → el costo por liquidación se calcula con
//     un default, y esa cifra es la que decide el precio del producto.
//
// No duplica `verificarEntornoCritico()` de `cuadra/startup.ts`, que revisa
// `DASHBOARD_SECRET` (una variable que sí es un agujero de seguridad, no una
// respuesta silenciosamente equivocada). Si aquella crece hasta cubrir estas,
// este archivo sobra.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { faltantes } from '@/lib/env';

const SILENCIOSAS: Array<{ nombre: string; consecuencia: string }> = [
  { nombre: 'DEMO_TENANT_ID', consecuencia: 'el panel consulta el tenant del seed y pinta cero liquidaciones' },
  { nombre: 'DASHBOARD_PASSCODE', consecuencia: 'proxy.ts no bloquea /dashboard' },
  { nombre: 'CUADRA_WHATSAPP_MSG_USD', consecuencia: 'el costo por liquidación usa el default 0.008' },
];

/**
 * Emite una línea en el arranque con el estado de esas variables.
 *
 * Solo en despliegues reales: en local estas ausencias son normales y el aviso
 * diario acabaría siendo ruido que se ignora, que es como muere un aviso.
 *
 * Nunca se emite el VALOR, solo el nombre y la consecuencia: el aviso existe
 * para vigilar la configuración, no para filtrarla por el log.
 */
export function avisarConfiguracionSilenciosa(): void {
  const desplegado = !!process.env.VERCEL_ENV || process.env.NODE_ENV === 'production';
  if (!desplegado) return;

  const faltan = SILENCIOSAS.filter((v) => !process.env[v.nombre]);
  if (faltan.length === 0) {
    logger.info('startup.config_silenciosa', { ok: true, revisadas: SILENCIOSAS.length });
  } else {
    logger.error('startup.config_silenciosa', {
      ok: false,
      faltan: faltan.map((v) => `${v.nombre}: ${v.consecuencia}`),
    });
  }

  avisarGruposDeConfiguracion();
}

/**
 * Y las variables cuya ausencia sí rompe algo, agrupadas por lo que apagan.
 *
 * Se emite con un `msg` PROPIO y no dentro del anterior a propósito: Sentry
 * agrupa por mensaje, y meter un aviso y otro distinto en el mismo cubo es cómo
 * se pierde el segundo. La misma razón por la que `startup.migraciones` no
 * debería usar el mismo `msg` para el fallo y para el `ok:true`.
 *
 * Estas se descubrirían solas —sin `SUPABASE_SERVICE_ROLE_KEY` la primera
 * consulta explota— pero se descubren en el turno de un operador, con el mensaje
 * críptico del SDK. Aquí salen antes de servir la primera petición, con el
 * nombre exacto de lo que falta.
 */
function avisarGruposDeConfiguracion(): void {
  const falta = faltantes();
  const grupos = Object.keys(falta);
  if (grupos.length === 0) {
    logger.info('startup.entorno_grupos', { ok: true });
    return;
  }
  logger.error('startup.entorno_grupos', { ok: false, faltan: falta });
}
