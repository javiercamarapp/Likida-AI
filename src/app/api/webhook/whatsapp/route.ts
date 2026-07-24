import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { verifyWebhookChallenge, verifySignature } from '@/lib/meta/client';
import { processInbound, type InboundMessage } from '@/lib/cuadra/processor';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

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
  const raw = await req.text();
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
  for (const m of messages) {
    after(async () => {
      try {
        await processInbound(m);
      } catch (e) {
        logger.error('processInbound', { err: e instanceof Error ? e.message : String(e) });
      }
    });
  }
  return NextResponse.json({ received: messages.length });
}

// ── parsing del payload de WhatsApp Cloud API ───────────────────────────────
interface WaWebhook {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
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
        if (m.type === 'text' && m.text) out.push({ from: m.from, type: 'text', text: m.text.body });
        else if (m.type === 'image' && m.image) out.push({ from: m.from, type: 'image', mediaId: m.image.id });
        else if (m.type === 'document' && m.document) out.push({ from: m.from, type: 'document', mediaId: m.document.id });
        else out.push({ from: m.from, type: 'other' });
      }
    }
  }
  return out;
}
