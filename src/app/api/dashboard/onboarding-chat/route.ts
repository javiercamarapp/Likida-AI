import { NextResponse, type NextRequest } from 'next/server';
import { getSessionTenant } from '@/lib/auth/session';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getPerfilCrudo } from '@/lib/likida/repo';
import { responderEntrevista } from '@/lib/likida/perfil/entrevista-agente';
import { tenantEfectivoChat } from '@/app/api/dashboard/chat/tenant';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface Mensaje { rol: 'usuario' | 'asistente'; texto: string }

function validarMensajes(crudo: unknown): Mensaje[] | null {
  if (!Array.isArray(crudo) || crudo.length === 0) return null;
  const limpios: Mensaje[] = [];
  for (const m of crudo.slice(-12)) {
    const rol = (m as { rol?: unknown })?.rol;
    const texto = (m as { texto?: unknown })?.texto;
    if ((rol !== 'usuario' && rol !== 'asistente') || typeof texto !== 'string' || !texto.trim()) return null;
    limpios.push({ rol, texto: texto.trim().slice(0, 2_000) });
  }
  if (limpios[limpios.length - 1].rol !== 'usuario') return null;
  return limpios;
}

export async function POST(req: NextRequest) {
  const sesion = await getSessionTenant();
  if (!sesion) return NextResponse.json({ error: 'sin sesion' }, { status: 401 });
  if (!puedeVerRuta(sesion.rol, '/dashboard/onboarding')) {
    return NextResponse.json({ error: 'sin acceso' }, { status: 403 });
  }

  const efectivo = await tenantEfectivoChat(sesion, req.nextUrl.searchParams.get('tenant'));
  if (!efectivo) return NextResponse.json({ error: 'sin acceso' }, { status: 403 });

  let cuerpo: unknown;
  try { cuerpo = await req.json(); } catch { return NextResponse.json({ error: 'cuerpo inválido' }, { status: 400 }); }
  const mensajes = validarMensajes((cuerpo as { mensajes?: unknown })?.mensajes);
  if (!mensajes) return NextResponse.json({ error: 'mensajes inválidos' }, { status: 400 });

  // Mismo recorte que /api/dashboard/chat: el cliente no es frontera.
  const docCrudo = (cuerpo as { documento?: { nombre?: unknown; extracto?: unknown } | null })?.documento;
  const documento = docCrudo && typeof docCrudo.nombre === 'string' && typeof docCrudo.extracto === 'string' && docCrudo.extracto.trim()
    ? { nombre: docCrudo.nombre.trim().slice(0, 120), extracto: docCrudo.extracto.slice(0, 16_000) }
    : null;
  const ultimo = documento
    ? `${mensajes[mensajes.length - 1].texto}\n\nDocumento «${documento.nombre}»:\n${documento.extracto}`
    : mensajes[mensajes.length - 1].texto;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controlador) {
      const manda = (ev: unknown) => {
        try { controlador.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`)); } catch { /* cliente cerró */ }
      };
      try {
        manda({ t: 'paso', fase: 'inicio', tool: 'leer_perfil' });
        let perfil: unknown = {};
        try { perfil = await getPerfilCrudo(efectivo.tenantId); }
        finally { manda({ t: 'paso', fase: 'fin', tool: 'leer_perfil' }); }
        const r = await responderEntrevista({
          tenantId: efectivo.tenantId,
          userId: sesion.userId,
          perfilCrudo: perfil,
          texto: ultimo,
          historial: mensajes.slice(0, -1),
          onPaso: (p) => manda({ t: 'paso', fase: p.fase, tool: p.tool }),
        });
        manda({
          t: 'fin',
          texto: r.texto,
          chips: r.chips,
          perfilListo: r.perfilListo,
          elegiblePeaje: r.elegiblePeaje,
          guardado: r.guardado,
        });
      } catch (e) {
        logger.error('onboarding_chat.turno', { err: e instanceof Error ? e.message : String(e) });
        manda({ t: 'error', error: 'no pude guardar esa declaración' });
      } finally {
        try { controlador.close(); } catch { /* ya cerrado */ }
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
