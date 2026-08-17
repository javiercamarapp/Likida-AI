// ═══════════════════════════════════════════════════════════════════════════
// LA API DEL BUS PARA WORKERS (0135) — el reemplazo del service role en la
// Mac. Cada acción exige SU capacidad; el resolver falla cerrado y deja
// telemetría. El contrato espeja EXACTAMENTE lo que bus.sh hacía contra
// PostgREST — mismo claim anclado a `pendiente`, mismo upsert sin tocar
// `estado` de una pieza aprobada.
// ═══════════════════════════════════════════════════════════════════════════
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolverLlaveWorker, type CapacidadWorker } from '@/lib/worker/llaves';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CAP_POR_ACCION: Record<string, CapacidadWorker> = {
  'corrida-inicio': 'bus.latido',
  'corrida-fin': 'bus.latido',
  'pieza': 'bus.pieza',
  'catalogo': 'bus.catalogo',
  'ordenes': 'bus.ordenes',
  'ordenes-claim': 'bus.ordenes',
  'ordenes-resolver': 'bus.ordenes',
};

/** 4 MB: la media de una pieza viaja en base64 — un video no cabe aquí a
 *  propósito (la Mac sube el preview, no el master). */
const TOPE_MEDIA = 4 * 1024 * 1024;

export async function POST(req: Request, ctx: { params: Promise<{ accion: string }> }) {
  const { accion } = await ctx.params;
  const cap = CAP_POR_ACCION[accion];
  if (!cap) return NextResponse.json({ error: 'Acción desconocida.' }, { status: 404 });
  const quien = await resolverLlaveWorker(req.headers.get('x-worker-key'), cap);
  if (!quien.ok) return NextResponse.json({ error: quien.error }, { status: 403 });

  const cuerpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const admin = supabaseAdmin();

  try {
    switch (accion) {
      case 'corrida-inicio': {
        const rutina = typeof cuerpo?.rutina === 'string' ? cuerpo.rutina.slice(0, 80) : '';
        if (!rutina) return NextResponse.json({ error: 'Falta rutina.' }, { status: 400 });
        const { data, error } = await admin.from('bus_corrida').insert({ rutina }).select('id').single();
        if (error) throw new Error(error.message);
        return NextResponse.json({ id: data.id });
      }
      case 'corrida-fin': {
        const id = typeof cuerpo?.id === 'string' ? cuerpo.id : '';
        if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Falta id.' }, { status: 400 });
        const { error } = await admin.from('bus_corrida').update({
          fin: new Date().toISOString(),
          exit_code: typeof cuerpo?.exitCode === 'number' ? cuerpo.exitCode : null,
          pr_url: typeof cuerpo?.prUrl === 'string' ? cuerpo.prUrl.slice(0, 300) : undefined,
          veredicto: typeof cuerpo?.veredicto === 'string' ? cuerpo.veredicto.slice(0, 300) : null,
        }).eq('id', id);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
      case 'pieza': {
        const carpeta = typeof cuerpo?.carpeta === 'string' ? cuerpo.carpeta.slice(0, 300) : '';
        if (!carpeta) return NextResponse.json({ error: 'Falta carpeta.' }, { status: 400 });
        let mediaPath: string | null = null;
        const b64 = typeof cuerpo?.mediaBase64 === 'string' ? cuerpo.mediaBase64 : null;
        if (b64) {
          if (b64.length > TOPE_MEDIA * 1.4) return NextResponse.json({ error: 'La media pasa de 4 MB.' }, { status: 413 });
          // El path lo arma el SERVIDOR con la carpeta declarada — el nombre
          // se sanea: un ../ aquí escribiría fuera de piezas/.
          const nombre = String(cuerpo?.mediaNombre ?? 'preview.png').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
          const objeto = `piezas/${carpeta.replace(/\.\./g, '_')}/${nombre}`;
          const up = await admin.storage.from('bus').upload(objeto, Buffer.from(b64, 'base64'), {
            contentType: typeof cuerpo?.mediaMime === 'string' ? cuerpo.mediaMime : 'application/octet-stream',
            upsert: true,
          });
          if (!up.error) mediaPath = objeto;
          else logger.warn('worker.pieza_media', { err: up.error.message });
        }
        const { error } = await admin.from('bus_pieza').upsert({
          rutina: String(cuerpo?.rutina ?? '').slice(0, 80),
          carpeta,
          titulo: String(cuerpo?.titulo ?? carpeta).slice(0, 200),
          tipo: String(cuerpo?.tipo ?? 'otro').slice(0, 30),
          copy_md: typeof cuerpo?.copyMd === 'string' ? cuerpo.copyMd.slice(0, 4000) : null,
          ...(mediaPath ? { media_path: mediaPath } : {}),
        }, { onConflict: 'carpeta' });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, mediaPath });
      }
      case 'catalogo': {
        const rutinas = Array.isArray(cuerpo?.rutinas) ? cuerpo.rutinas.slice(0, 50) : null;
        if (!rutinas) return NextResponse.json({ error: 'Faltan rutinas.' }, { status: 400 });
        const filas = rutinas.map((r) => {
          const x = r as Record<string, unknown>;
          return {
            nombre: String(x.nombre ?? '').slice(0, 80),
            horario: String(x.horario ?? '').slice(0, 120),
            descripcion: String(x.descripcion ?? '').slice(0, 200),
            encargo_md: String(x.encargo_md ?? '').slice(0, 20000),
            actualizado_en: new Date().toISOString(),
          };
        }).filter((f) => f.nombre);
        const { error } = await admin.from('bus_rutina').upsert(filas, { onConflict: 'nombre' });
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, sembradas: filas.length });
      }
      case 'ordenes': {
        const { data, error } = await admin.from('bus_orden')
          .select('id, tipo, rutina, payload, creado_en')
          .eq('estado', 'pendiente').order('creado_en').limit(10);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ordenes: data ?? [] });
      }
      case 'ordenes-claim': {
        const id = typeof cuerpo?.id === 'string' ? cuerpo.id : '';
        if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Falta id.' }, { status: 400 });
        // El claim anclado a `pendiente` — la atomicidad vive en el WHERE.
        const { data, error } = await admin.from('bus_orden')
          .update({ estado: 'tomada', tomada_en: new Date().toISOString() })
          .eq('id', id).eq('estado', 'pendiente').select('id');
        if (error) throw new Error(error.message);
        return NextResponse.json({ tomada: (data ?? []).length === 1 });
      }
      case 'ordenes-resolver': {
        const id = typeof cuerpo?.id === 'string' ? cuerpo.id : '';
        if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Falta id.' }, { status: 400 });
        const { error } = await admin.from('bus_orden').update({
          estado: cuerpo?.ok === true ? 'hecha' : 'fallida',
          resuelta_en: new Date().toISOString(),
          resultado: String(cuerpo?.resultado ?? '').slice(0, 400) || 'sin detalle',
        }).eq('id', id);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true });
      }
    }
    return NextResponse.json({ error: 'Acción desconocida.' }, { status: 404 });
  } catch (e) {
    logger.error('worker.bus', { accion, worker: quien.nombre, err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'La operación no se pudo completar.' }, { status: 500 });
  }
}
