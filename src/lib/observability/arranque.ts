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
//   · `LIKIDA_WHATSAPP_MSG_USD` ausente → el costo por liquidación se calcula con
//     un default, y esa cifra es la que decide el precio del producto.
//   · `NEXT_PUBLIC_APP_URL` ausente → `login/page.tsx` cae a
//     `https://app.likida.ai` y manda los magic links y el retorno de Google a
//     PRODUCCIÓN, sea cual sea el despliegue que los emitió. El correo llega, el
//     link abre, y la sesión se completa en otro sitio: no hay error en ninguna
//     parte, simplemente nadie entra donde creía.
//     El suelo era `https://likida.ai` hasta el 17-ago-2026, y ahí el fallo era
//     peor: ese dominio dejó de servir esta app (hoy es la landing estática) y
//     no tiene `/auth/callback`, así que el magic link no completaba sesión en
//     NINGÚN sitio. Hoy el suelo al menos es una app que existe — la variable
//     sigue haciendo falta para que un preview no se robe el login de prod.
//
// `DASHBOARD_PASSCODE` YA NO VIVE AQUÍ. Hasta el 5-ago-2026 esta lista traía
// «`DASHBOARD_PASSCODE` ausente → `proxy.ts` no bloquea `/dashboard`» — y era
// falso desde que `proxy.ts` se reescribió para gatear con Supabase Auth: el
// passcode y `/acceso` quedaron sin ningún llamador (`tokenMatches` sin uso
// fuera de sus propias pruebas) y se borraron enteros (auditoría 10,
// seguridad, hallazgo BAJO). El gate real de `/dashboard` no depende de
// ninguna variable de entorno silenciosa — está en el matcher de sesión de
// `proxy.ts` (`RUTAS_CON_SESION`) y no tiene un interruptor que se pueda
// olvidar poner.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { faltantes, envPuesta } from '@/lib/env';

/** Exportada para que `runbook.test.ts` itere sobre ESTA lista y no sobre un
 *  literal propio: así, cada variable que entre aquí tiene que entrar también
 *  a la tabla de DEPLOY.md o la suite lo dice (AUDITORÍA 18, A18 — las dos
 *  últimas entraron sin que el runbook se enterara). */
export const SILENCIOSAS: Array<{ nombre: string; consecuencia: string }> = [
  { nombre: 'DEMO_TENANT_ID', consecuencia: 'el panel consulta el tenant del seed y pinta cero liquidaciones' },
  { nombre: 'LIKIDA_WHATSAPP_MSG_USD', consecuencia: 'el costo por liquidación usa el default 0.008' },
  {
    nombre: 'NEXT_PUBLIC_APP_URL',
    consecuencia:
      'login arma sus redirects contra https://app.likida.ai (el fallback del código) en vez del dominio desplegado: el magic link y el retorno de Google apuntan a otro sitio y nadie entra donde creía, sin un solo error',
  },
  // El canal de alerta del operador (observability/alerta.ts). Sin ella el
  // sistema arranca y atiende igual — que es exactamente lo que califica para
  // esta lista: un cron puede fallar nueve días y el único rastro es un issue
  // viejo de Sentry que ya no notifica.
  { nombre: 'ALERTA_EMAIL', consecuencia: 'los fallos de cron no le llegan a nadie por correo' },
];

/**
 * Emite una línea en el arranque con el estado de esas variables.
 *
 * Las SILENCIOSAS solo en despliegues reales: en local esas ausencias son
 * normales y el aviso diario acabaría siendo ruido que se ignora, que es como
 * muere un aviso. Los GRUPOS DUROS (abajo) se avisan también en local cuando
 * falta algo (AUDITORÍA 18, M17): es justo en `npm run dev`, con el
 * `.env.example` recién copiado y vacío, donde nadie tiene un panel de logs y
 * el único síntoma era el error críptico del SDK al abrir /dashboard.
 *
 * Nunca se emite el VALOR, solo el nombre y la consecuencia: el aviso existe
 * para vigilar la configuración, no para filtrarla por el log.
 */
export function avisarConfiguracionSilenciosa(): void {
  const desplegado = !!process.env.VERCEL_ENV || process.env.NODE_ENV === 'production';
  if (!desplegado) {
    avisarGruposDeConfiguracion(false);
    return;
  }

  const faltan = SILENCIOSAS.filter((v) => !envPuesta(v.nombre));
  if (faltan.length === 0) {
    logger.info('startup.config_silenciosa', { ok: true, revisadas: SILENCIOSAS.length });
  } else {
    logger.error('startup.config_silenciosa', {
      ok: false,
      faltan: faltan.map((v) => `${v.nombre}: ${v.consecuencia}`),
    });
  }

  avisarGruposDeConfiguracion(true);
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
function avisarGruposDeConfiguracion(desplegado: boolean): void {
  const falta = faltantes();
  const grupos = Object.keys(falta);
  if (grupos.length === 0) {
    // El "todo bien" solo en despliegues: en local sería la línea diaria que
    // nadie lee; lo que SÍ se dice en local es lo que falta.
    if (desplegado) logger.info('startup.entorno_grupos', { ok: true });
    return;
  }
  logger.error('startup.entorno_grupos', { ok: false, faltan: falta });
}
