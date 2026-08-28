import { NextResponse } from 'next/server';
import { correrDescargaSat } from '@/lib/likida/sat_descarga/ciclo';
import { avisarCierrePeaje } from '@/lib/likida/sat_descarga/peaje_cierre';
import { leerInterruptor, type NombreInterruptor } from '@/lib/likida/interruptores';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';
import { puertaCron, registrarLatido } from '@/lib/admin/salud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * EL CRON DE LA DESCARGA MASIVA DEL SAT (0231).
 *
 * CADA 6 HORAS, AL MINUTO 25. La cadencia la fija el SAT, no nosotros: una
 * solicitud tarda hasta seis días en madurar, así que preguntar cada minuto
 * sería quemar cuota para oír "sigue en proceso". Cuatro veces al día recoge
 * un paquete el mismo día que queda listo y deja margen de sobra dentro de las
 * 72 horas que vive antes de caducar.
 *
 * EL MINUTO 25 ESTÁ DESFASADO A PROPÓSITO. Los otros crons salen en 0, 5, 7 y
 * 15: amontonar uno más en el minuto 0 es pedir que la estampida se lleve la
 * cuota de la plataforma y el pool de conexiones a la misma hora. 25 no lo
 * comparte nadie.
 *
 * DOS TRABAJOS, UNA CORRIDA, y no es una mezcla arbitraria: son las dos caras
 * del mismo problema.
 *   1. `correrDescargaSat` recoge lo que el comercio YA timbró — lo que cae
 *      solo.
 *   2. `avisarCierrePeaje` avisa de lo que NO cae solo y cuyo derecho a
 *      facturar se extingue el último día del mes (PASE). Corre aquí porque
 *      necesita el mismo grano fino: un aviso que llegue el día 1 del mes
 *      siguiente no vale nada.
 *
 * EL AVISO DE PEAJE NO DEPENDE DE QUE LA DESCARGA ESTÉ CONFIGURADA. Es la
 * distinción entera: una flota SIN e.firma ni contrato de PAC igual pierde el
 * derecho a facturar sus casetas cada 30 días, y merece el aviso. Por eso los
 * dos trabajos se cuentan por separado en la respuesta y el segundo corre
 * aunque el primero devuelva "no configurado".
 */
export async function GET(req: Request) {
  const puerta = await puertaCron('descarga-sat', req, 'La descarga masiva del SAT no corre sin él.');
  if (puerta) return puerta;

  // Fail-closed: `ilegible` es FALLO (500), no salto. No saber si algo está
  // apagado no es lo mismo que saber que está encendido.
  for (const nombre of ['global', 'agente:descarga_sat'] as NombreInterruptor[]) {
    const v = await leerInterruptor(nombre);
    if (v === 'ilegible') {
      return NextResponse.json({
        corrio: false,
        error: `No se pudo leer el interruptor ${nombre}: la descarga no corre sin saber si está apagada.`,
        codigo: 'interruptor_ilegible',
        interruptor: nombre,
      }, { status: 500 });
    }
    if (v === 'apagado') {
      logger.warn('cron.descarga-sat.saltado', { interruptor: nombre });
      await registrarLatido('descarga-sat', 'saltado', { interruptor: nombre });
      return NextResponse.json({ corrio: false, saltado: `interruptor ${nombre}` });
    }
  }

  try {
    const descarga = await correrDescargaSat(new Date());
    // El aviso de peaje va DESPUÉS y en su propio try: si la descarga tropieza
    // con el proveedor, el reloj del cierre de mes sigue corriendo igual y el
    // contralor merece su aviso.
    let peaje: Awaited<ReturnType<typeof avisarCierrePeaje>> | null = null;
    let peajeError: string | null = null;
    try {
      peaje = await avisarCierrePeaje(new Date());
    } catch (e) {
      peajeError = e instanceof Error ? e.message : String(e);
      logger.error('cron.descarga-sat.peaje_falló', { error: peajeError });
    }

    const errores = descarga.resumenes.reduce((n, r) => n + r.errores.length, 0);
    const cfdis = descarga.resumenes.reduce((n, r) => n + r.cfdisNuevos, 0);
    const casados = descarga.resumenes.reduce((n, r) => n + r.casados, 0);
    logger.info('cron.descarga-sat.ok', {
      corrio: descarga.corrio, flotas: descarga.flotas, cfdis, casados, errores,
    });

    // 'parcial' cuando algo no salió limpio: un latido verde con errores
    // adentro es la clase de mentira que este panel no se permite. "No
    // configurado" TAMBIÉN es parcial — el circuito no está haciendo su
    // trabajo, y llamarlo 'ok' escondería que falta el contrato del PAC.
    const sano = descarga.corrio && errores === 0 && peajeError === null;
    await registrarLatido('descarga-sat', sano ? 'ok' : 'parcial', {
      flotas: descarga.flotas, cfdis, casados, errores,
      motivo: descarga.motivo ?? null,
      peajeAvisadas: peaje?.avisadas ?? null,
    });

    return NextResponse.json({
      ...descarga,
      cfdis, casados, errores,
      peaje: peaje ?? { corrio: false, error: peajeError },
    }, { status: 200 });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.descarga-sat.falló', { error, codigo });
    await alertarOperador('cron.descarga-sat', { error, codigo });
    await registrarLatido('descarga-sat', 'fallo', { codigo });
    return NextResponse.json({ error }, { status: 500 });
  }
}
