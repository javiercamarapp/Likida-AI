import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { verifyWebhookChallenge, verifySignature } from '@/lib/meta/client';
import { processInbound, type InboundMessage } from '@/lib/cuadra/processor';
import { rateLimit, bodyExcede } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';

const MAX_BODY = 256 * 1024;   // 256 KB — un webhook de Meta es pequeño
const MSGS_POR_MIN = 40;        // por teléfono (una ráfaga de 12 fotos cabe holgada)

export const runtime = 'nodejs';
// ME-13 / AUDIT_V3 orquestación: el procesamiento corre en after() y su presupuesto
// en el PEOR caso es acquireViajeLock(≤12s) + esperarIntake (CUADRA_INTAKE_ESPERA_MS,
// hoy 20s) + cuadre (~40s) ≈ 72s. Eso NO cabía en los 60s que había aquí: una
// ráfaga de fotos lenta se cortaba a media liquidación, y Meta ya tiene su 200 —
// no reintenta. El operador se queda esperando un PDF que nadie va a mandar.
//
// El riesgo estaba abierto porque una sesión anterior no pudo confirmar el plan y
// dejó 60 por prudencia, suponiendo Hobby. VERIFICADO el 28-jul-2026 contra la API
// de Vercel: el equipo `likida` (team_uelpa362Txivu…) está en plan **pro**, donde
// el tope es 300s. Aquella nota miraba otra cuenta.
//
// Se sube a 120, que es lo que aquella misma nota recomendaba para el caso de que
// el plan lo permitiera: cubre el peor caso con casi el doble de margen sin dejar
// una petición colgada cinco minutos. El techo de 300 queda disponible si hiciera
// falta. Mover el procesamiento pesado a QStash sigue siendo el arreglo de fondo.
export const maxDuration = 120;

// GET — verificación del webhook (Meta lo llama una vez al configurar).
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (verifyWebhookChallenge(p.get('hub.mode'), p.get('hub.verify_token'))) {
    return new NextResponse(p.get('hub.challenge') ?? '', { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

// POST — mensajes entrantes. Verifica HMAC, responde 200 rápido y procesa en after().
export async function POST(req: NextRequest) {
  // CAP DE BODY antes de leer/HMAC: evita DoS por cuerpo enorme sin firma.
  if (bodyExcede(req, MAX_BODY)) return new NextResponse('Payload too large', { status: 413 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return new NextResponse('Payload too large', { status: 413 }); // por si falta content-length
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'))) {
    return new NextResponse('Invalid signature', { status: 401 });
  }

  let payload: WaWebhook;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse('Bad JSON', { status: 400 });
  }

  const messages = extractMessages(payload);
  // Rate limit por TELÉFONO (no por IP: todo Meta viene de sus IPs).
  const permitidos = messages.filter((m) => {
    const ok = rateLimit(`wa:${m.from}`, MSGS_POR_MIN, 60_000);
    if (!ok) logger.warn('wa.ratelimit', { from: m.from });
    return ok;
  });

  // 1.3: Meta PUEDE entregar varios mensajes (fotos) en UN POST → comparten los
  // 60s de UNA invocación. Se procesan en UN solo after() con Promise.all para
  // GARANTIZAR concurrencia (no depender de si Next corre N after() en serie).
  // Con la barrera de intake las fotos ya corren en paralelo → un lote de 8 cabe
  // holgado en 60s (medido: 8 en paralelo ≈ 3.5s vs 24s en serie).
  if (permitidos.length) {
    after(async () => {
      await Promise.all(
        permitidos.map((m) =>
          processInbound(m).catch((e) => logger.error('processInbound', { err: e instanceof Error ? e.message : String(e) })),
        ),
      );
    });
  }
  return NextResponse.json({ received: permitidos.length });
}

// ── parsing del payload de WhatsApp Cloud API ───────────────────────────────
interface WaWebhook {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id: string;
          from: string;
          type: string;
          text?: { body: string };
          image?: { id: string };
          document?: { id: string };
        }>;
      };
    }>;
  }>;
}

function extractMessages(p: WaWebhook): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) {
        const base = { from: m.from, waMessageId: m.id };
        if (m.type === 'text' && m.text) out.push({ ...base, type: 'text', text: m.text.body });
        else if (m.type === 'image' && m.image) out.push({ ...base, type: 'image', mediaId: m.image.id });
        else if (m.type === 'document' && m.document) out.push({ ...base, type: 'document', mediaId: m.document.id });
        else out.push({ ...base, type: 'other' });
      }
    }
  }
  return out;
}
