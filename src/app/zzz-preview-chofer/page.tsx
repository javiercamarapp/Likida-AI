/* PREVIEW TEMPORAL — se borra al terminar de mirar el render.
 *
 * Importa los componentes REALES de /chofer (marco + vista) y les da datos
 * REALES del tenant demo, leídos con el service-role porque esta ruta no tiene
 * sesión de chofer. Lo único que cambia respecto de producción es de dónde
 * viene el dato; lo que se dibuja es exactamente lo que se sirve.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ligaComprobante } from '@/lib/cuadra/intake/almacen';
import { estadoDelViaje } from '@/lib/cuadra/consulta_chofer';
import {
  resumenLiquidacion, estadoComprobante,
  type ViajeChofer, type ComprobanteChofer, type ViajeHistorial,
} from '@/lib/cuadra/chofer';
import { MarcoChofer } from '../chofer/marco';
import {
  Titulo, Pendiente, Tarjeta, ViajeDeHoy, SinViaje, SaldoEnVivo,
  ListaComprobantes, ListaViajes, FilaComprobante, TOQUE,
} from '../chofer/vista';
import { mxn } from '@/lib/formato';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OPERADOR = '33333333-0000-0000-0000-0000000000ff';
const VIAJE_CON_GASTOS = '06fbe093-7d0c-4896-a148-545cb16ac046';

const CAMPOS = 'id, folio, origen, destino, anticipo, fecha_inicio, estatus, avisado_en, aceptado_en, unidad_id';

function mapear(v: Record<string, unknown>): ViajeChofer {
  return {
    id: v.id as string,
    folio: (v.folio as string) ?? null,
    origen: (v.origen as string) ?? null,
    destino: (v.destino as string) ?? null,
    anticipo: Number(v.anticipo ?? 0),
    fechaInicio: (v.fecha_inicio as string) ?? null,
    estatus: (v.estatus as string) ?? 'abierto',
    avisadoEn: (v.avisado_en as string) ?? null,
    aceptadoEn: (v.aceptado_en as string) ?? null,
    unidadId: (v.unidad_id as string) ?? null,
  };
}

async function nada() {
  'use server';
}

export default async function Preview({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const p = (await searchParams).p ?? 'hoy';
  const admin = supabaseAdmin();

  if (p === 'hoy') {
    const { data } = await admin.from('viaje').select(CAMPOS)
      .eq('tenant_id', TENANT).eq('operador_id', OPERADOR)
      .in('estatus', ['abierto', 'en_cuadre']).limit(1);
    const viaje = data?.[0] ? mapear(data[0]) : null;
    return (
      <MarcoChofer nombre="Juan Pérez Ramírez" cerrarSesion={nada} ruta="/chofer">
        <Titulo>Hoy</Titulo>
        {!viaje ? <SinViaje /> : (
          <>
            <ViajeDeHoy viaje={viaje} unidad={null} />
            <form action={nada} className="flex flex-col gap-3">
              <button type="submit" className="w-full rounded-2xl text-lg font-semibold"
                style={{ minHeight: 56, background: 'var(--marca)', color: 'var(--marca-fg)' }}>
                Acepto este viaje
              </button>
              <p className="text-sm text-center" style={{ color: 'var(--muted)' }}>
                Tu oficina ve que ya lo aceptaste y deja de insistirte.
              </p>
            </form>
            <Link href="/chofer/liquidacion" className="card px-4 flex items-center justify-between gap-3 text-base font-medium"
              style={{ minHeight: TOQUE.principal }}>
              Ver cuánto llevo comprobado
              <ChevronRight width={20} height={20} strokeWidth={2} style={{ color: 'var(--muted)' }} />
            </Link>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              Los comprobantes se siguen mandando por WhatsApp: aquí solo los consultas.
            </p>
          </>
        )}
      </MarcoChofer>
    );
  }

  if (p === 'vacio') {
    return (
      <MarcoChofer nombre="Juan Pérez Ramírez" cerrarSesion={nada} ruta="/chofer">
        <Titulo>Hoy</Titulo>
        <SinViaje />
      </MarcoChofer>
    );
  }

  const { data: dv } = await admin.from('viaje').select(CAMPOS).eq('id', VIAJE_CON_GASTOS).limit(1);
  const viaje = mapear(dv![0]);

  if (p === 'saldo') {
    const e = await estadoDelViaje(TENANT, viaje.id);
    const r = resumenLiquidacion(e!);
    return (
      <MarcoChofer nombre="Juan Pérez Ramírez" cerrarSesion={nada} ruta="/chofer/liquidacion">
        <Titulo>Mi saldo</Titulo>
        <p className="text-base -mt-1" style={{ color: 'var(--muted)' }}>Viaje {viaje.folio}</p>
        <SaldoEnVivo r={r} />
        <Link href="/chofer/comprobantes" className="card px-4 flex items-center justify-between gap-3 text-base font-medium"
          style={{ minHeight: TOQUE.principal }}>
          Ver mis comprobantes
          <ChevronRight width={20} height={20} strokeWidth={2} style={{ color: 'var(--muted)' }} />
        </Link>
      </MarcoChofer>
    );
  }

  if (p === 'saldo-sin-anticipo') {
    const e = await estadoDelViaje(TENANT, viaje.id);
    const r = resumenLiquidacion({ ...e!, anticipo: 0 });
    return (
      <MarcoChofer nombre="Juan Pérez Ramírez" cerrarSesion={nada} ruta="/chofer/liquidacion">
        <Titulo>Mi saldo</Titulo>
        <SaldoEnVivo r={r} />
      </MarcoChofer>
    );
  }

  if (p === 'tickets') {
    const { data } = await admin.from('gasto')
      .select('id, concepto, monto, fecha, ocr_confianza, imagen_url, created_at')
      .eq('tenant_id', TENANT).eq('viaje_id', viaje.id)
      .order('created_at', { ascending: false }).limit(8);
    const lista: ComprobanteChofer[] = await Promise.all((data ?? []).map(async (g) => ({
      id: g.id as string,
      concepto: g.concepto as string,
      monto: Number(g.monto),
      fecha: (g.fecha as string) ?? null,
      estado: estadoComprobante(g.ocr_confianza as number | null),
      foto: g.imagen_url ? ((await ligaComprobante(g.imagen_url as string, 600)) ?? null) : null,
    })));
    const e = await estadoDelViaje(TENANT, viaje.id);
    const r = resumenLiquidacion(e!);
    // El estado "Reenvíala" NO existe en los datos reales (la confianza mínima
    // del tenant demo es 0.9), y es el que más importa mirar. Se pinta aquí,
    // ROTULADO, solo para verlo: este archivo se borra.
    const malLeido: ComprobanteChofer = { ...lista[0], id: 'demo-revisar', estado: 'revisar' };
    return (
      <MarcoChofer nombre="Juan Pérez Ramírez" cerrarSesion={nada} ruta="/chofer/comprobantes">
        <Titulo>Mis comprobantes</Titulo>
        <p className="text-base -mt-1" style={{ color: 'var(--muted)' }}>Viaje {viaje.folio}</p>
        <Tarjeta className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-sm" style={{ color: 'var(--muted)' }}>Comprobado</div>
            <div className="text-2xl font-semibold tracking-tight tabular mt-0.5">{mxn(r.comprobado)}</div>
          </div>
          <div className="text-right">
            <div className="text-sm" style={{ color: 'var(--muted)' }}>Comprobantes</div>
            <div className="text-2xl font-semibold tracking-tight tabular mt-0.5">{r.comprobantes}</div>
          </div>
        </Tarjeta>
        <ul className="flex flex-col gap-3"><FilaComprobante c={malLeido} /></ul>
        <ListaComprobantes comprobantes={lista} />
        <p className="text-sm text-center" style={{ color: 'var(--faint)' }}>
          Se muestran los {lista.length} más recientes de {r.comprobantes}.
        </p>
      </MarcoChofer>
    );
  }

  // viajes
  const { data } = await admin.from('viaje')
    .select(`${CAMPOS}, liquidacion(total_comprobado, total_anticipo, diferencia, estatus, pdf_url)`)
    .eq('tenant_id', TENANT).eq('operador_id', OPERADOR)
    .order('created_at', { ascending: false }).limit(20);
  const viajes: ViajeHistorial[] = await Promise.all((data ?? []).map(async (v) => {
    const cruda = (v as Record<string, unknown>).liquidacion;
    const liq = (Array.isArray(cruda) ? cruda[0] : cruda) as Record<string, unknown> | null | undefined;
    let pdf: string | null = null;
    if (liq?.pdf_url) {
      const f = await admin.storage.from('liquidaciones').createSignedUrl(liq.pdf_url as string, 600);
      pdf = f.data?.signedUrl ?? null;
    }
    return {
      ...mapear(v as Record<string, unknown>),
      liquidacion: liq ? {
        comprobado: Number(liq.total_comprobado ?? 0),
        anticipo: Number(liq.total_anticipo ?? 0),
        diferencia: Number(liq.diferencia ?? 0),
        estatus: (liq.estatus as string) ?? 'cuadrada',
        pdf,
      } : null,
    };
  }));

  return (
    <MarcoChofer nombre="Juan Pérez Ramírez" cerrarSesion={nada} ruta="/chofer/viajes">
      <Titulo>Mis viajes</Titulo>
      {viajes.length === 0 ? <Pendiente>Todavía no tienes viajes.</Pendiente> : <ListaViajes viajes={viajes} />}
    </MarcoChofer>
  );
}
