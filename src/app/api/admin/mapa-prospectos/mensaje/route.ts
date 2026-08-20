// ═══════════════════════════════════════════════════════════════════════════
// EL AGENTE EXPERTO EN MENSAJES — POST /api/admin/mapa-prospectos/mensaje
//
// Recibe {id} y redacta el primer toque (WhatsApp + correo) con TODA la info
// del prospecto: empresa, decisor, la CAUSA (su vacante textual, su giro, su
// plaza, el dolor de las notas del censo/ficha). Escribe el resultado a las
// columnas de la 0129 y lo devuelve — el botón del Cerebro abre con esto.
//
// Modelo: rol `marketing` de models.ts (hoy gpt-5.6-luna, ~$0.10/M — stack
// 100% USA, regla legal). El costo por mensaje es ~décimas de centavo y se
// deja en el logger con tokens y modelo; no entra a llm_costo porque su
// dominio de fases (ocr/cuadre/chat/…) es del producto por-tenant y este
// gasto es de la plataforma — inventarle una fase ahí partiría el tablero
// de consumo en dos vocabularios. Si el gasto de marketing crece, la fase
// se agrega por migración, no por colado.
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateStructured } from '@/lib/llm/openrouter';
import { giroDe, NOMBRE_GIRO } from '@/lib/admin/prospectos-mapa';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { sesionSuperadmin } from '../puerta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Salida = z.object({
  mensaje_wa: z.string().min(40).max(600),
  correo_asunto: z.string().min(6).max(90),
  correo_cuerpo: z.string().min(80).max(1400),
});

const SYSTEM = `Eres el redactor de primeros toques B2B de Likida.ai (liquidación de viajes de flotas por WhatsApp, México). Escribes en español mexicano, directo y profesional — tono norteño de negocios, cero humo.

Reglas DURAS (violarlas invalida el mensaje):
- Likida NO tiene clientes todavía: jamás "nuestros clientes"; el framing es "estamos eligiendo a las primeras flotas".
- Cifras SOLO canónicas — no inventes ninguna otra: $35 por viaje (tabulador por volumen $38 / $35 / $31.25), ciclo manual ~$105 por viaje. El diésel SOLO se habla en litros elegibles; JAMÁS en pesos del estímulo — esa es la línea que no se cruza (es materia fiscal delicada, litros sí, pesos del estímulo no).
- La PERSONALIZACIÓN es la causa del mensaje: si hay vacante publicada, se cita textual y es el gancho ("vi que buscan X — ese trabajo es el que automatizamos"); si no, el gancho es su giro y su plaza. Si hay nombre del decisor, se le habla a él por su nombre de pila, de usted.
- Qué hace Likida (esto sí, en una línea): el operador manda sus comprobantes por WhatsApp y la liquidación sale cuadrada, con lo fiscal separado y su PDF; el número lo calcula un motor, no una IA.
- CTA única: 15 minutos esta semana.
- WhatsApp: máximo 6 líneas, sin saludos largos. Correo: máximo 120 palabras, asunto anclado al gancho (nunca "Propuesta comercial"), firma "Javier Cámara — Likida.ai".
- Nada de emojis en el correo; en WhatsApp máximo uno.`;

export async function POST(req: Request) {
  const { error, sesion } = await sesionSuperadmin();
  if (error) return error;
  // Techo de ráfaga, no de negocio: 120/hora cubre una sesión intensa de
  // prospección y frena un loop de UI descontrolado.
  if (!(await rateLimit('cerebro:mensaje', 120, 3_600_000))) {
    return NextResponse.json({ error: 'Tope de generación por hora alcanzado — respira y vuelve.' }, { status: 429 });
  }

  const cuerpo = (await req.json().catch(() => null)) as { id?: string } | null;
  const id = cuerpo?.id;
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ error: 'Falta el id del prospecto.' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: p, error: errLeer } = await admin
    .from('prospecto')
    .select('id, empresa, ciudad, telefono, correo, contacto_nombre, vacante, estado, fuente, notas')
    .eq('id', id)
    .single();
  if (errLeer || !p) return NextResponse.json({ error: 'Ese prospecto no existe.' }, { status: 404 });

  const giro = giroDe(p.empresa, p.vacante, p.notas);
  const ficha = [
    `Empresa: ${p.empresa}`,
    `Giro: ${NOMBRE_GIRO[giro]}`,
    p.ciudad ? `Plaza: ${p.ciudad}` : null,
    p.contacto_nombre ? `Decisor: ${p.contacto_nombre}` : 'Decisor: no identificado aún',
    p.vacante ? `Vacante publicada (el gancho, cítala): "${p.vacante}"` : 'Sin vacante conocida — el gancho es el giro y la plaza.',
    p.notas ? `Todo lo que sabemos (censo/fichas/DENUE):\n${p.notas.slice(0, 1500)}` : null,
  ].filter(Boolean).join('\n');

  try {
    const r = await generateStructured({
      role: 'marketing',
      system: SYSTEM,
      messages: [{ role: 'user', content: `Redacta el primer toque (mensaje_wa, correo_asunto, correo_cuerpo) para este prospecto:\n\n${ficha}` }],
      schema: Salida,
      schemaName: 'primer_toque',
      maxTokens: 900,
      temperature: 0.7,
      signal: AbortSignal.timeout(30_000),
    });
    const ahora = new Date().toISOString();
    const { error: errEscribir } = await admin
      .from('prospecto')
      .update({
        mensaje_wa: r.data.mensaje_wa,
        mensaje_correo_asunto: r.data.correo_asunto,
        mensaje_correo: r.data.correo_cuerpo,
        mensajes_generados_en: ahora,
        mensajes_modelo: r.model,
      })
      .eq('id', id);
    if (errEscribir) throw new Error(errEscribir.message);
    logger.info('cerebro.mensaje_generado', {
      prospecto: id, modelo: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut,
      costoUsd: r.cost, actor: sesion.userId,
    });
    return NextResponse.json({
      mensajeWaIa: r.data.mensaje_wa,
      correoAsuntoIa: r.data.correo_asunto,
      correoCuerpoIa: r.data.correo_cuerpo,
      mensajesGeneradosEn: ahora,
    });
  } catch (e) {
    logger.error('cerebro.mensaje_fallo', { prospecto: id, err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'El redactor no contestó — el botón sigue con la plantilla.' }, { status: 502 });
  }
}
