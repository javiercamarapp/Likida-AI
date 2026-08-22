import { NextResponse } from 'next/server';
import { correrRunner } from '@/lib/likida/agentes/runner';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { alertarOperador } from '@/lib/observability/alerta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Hasta 5 piezas × una completion corta cada una: lejos del techo.
export const maxDuration = 120;

// ═══════════════════════════════════════════════════════════════════════════
// EL LATIDO DEL RUNNER NIVEL 2 (0123) — cada 4 horas despacha los agentes
// autónomos ACOTADOS (vivos + habilitados + con techo declarado). A 5 piezas
// por vuelta son máx. 30 borradores/día — la misma banda que el tope de
// envío (20-40) protege del otro lado; los dos frenos son independientes a
// propósito.
//
// FALLA CERRADO SIN SECRETO, como todo cron: esta ruta gasta dinero de
// modelo y fabrica piezas hacia la bandeja de Javier.
// ═══════════════════════════════════════════════════════════════════════════
export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    logger.error('cron.runner.sin_secreto', {});
    return NextResponse.json({ error: 'CRON_SECRET no está configurado.' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secreto}`) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const r = await correrRunner();
    logger.info('cron.runner', {
      apagadoGlobal: r.apagadoGlobal,
      agentes: r.agentes.map((a) => ({ agente: a.agente, resultado: a.resultado, piezas: a.piezas, motivo: a.motivo?.slice(0, 120) })),
    });
    return NextResponse.json(r);
  } catch (e) {
    // El runner entero no pudo ni arrancar (p. ej. la lista de agentes no se
    // leyó): 500 para que el panel de crons de Vercel lo pinte rojo — un 200
    // aquí escondería al orquestador muerto.
    //
    // AUDITORÍA 18, M15: era el único cron sin `codigo` ni correo. Sin código,
    // seis fallos al día durante una semana eran 42 eventos en UN issue de
    // Sentry que notificó una vez; sin `alertarOperador`, cero correos. Mismo
    // par que los otros cuatro crons.
    const error = e instanceof Error ? e.message : String(e);
    const codigo = codigoDeError(e);
    logger.error('cron.runner.fallo', { error, codigo });
    await alertarOperador('cron.runner', { error, codigo });
    return NextResponse.json({ error: 'El runner no pudo correr — el detalle quedó en los registros.' }, { status: 500 });
  }
}
