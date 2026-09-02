import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { Stamp } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { estadoPac } from '@/lib/likida/pac';
import { guardarPerfilFiscal } from '@/lib/likida/carta_porte_timbre';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { logger } from '@/lib/logger';
import { FormaConAviso, Campo, Selector, type ResultadoAccion } from '../../admin/ui/forma';

/**
 * TIMBRADO (0226) — el perfil del EMISOR y el estado del PAC, en el panel del
 * contador por la misma razón que la plantilla ERP: el dato es fiscal y quien
 * puede declarar "este RFC, esta razón social, este régimen son los de mi
 * constancia" es el contador.
 *
 * ENVIAR ES DECLARAR: los campos van al CFDI tal cual — un RFC con un dedazo
 * es un timbre rebotado (o peor, uno mal emitido). Por eso los formatos se
 * validan en base (CHECKs de la 0226) y el error regresa en cristiano.
 *
 * La pantalla también dice, sin adornos, QUÉ FALTA para timbrar de verdad:
 * el PAC se configura con variables de entorno (contrato de Javier) y el CSD
 * de la flota vive en la bóveda del PAC, jamás en Likida.
 */

const t = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export async function Timbrado({ searchParams, tenantExiste, sufijo = '' }: {
  searchParams: { vista?: string; tenant?: string; rol?: string };
  tenantExiste: boolean;
  /** El `?tenant=`/`?vista=`/`?rol=` del superadmin; vacío para roles reales. */
  sufijo?: string;
}) {
  if (!tenantExiste) return null;

  const { tenantId } = await resolverTenantEfectivo('/dashboard/contador', searchParams);
  const pac = estadoPac();

  // Mismo patrón leyoOk que perfil-erp: un error de lectura NO es "sin
  // perfil" — confundirlos invita a recapturar encima de un perfil real.
  let perfil: Record<string, unknown> | null = null;
  let leyoOk = true;
  try {
    const { data, error } = await acotada(supabaseAdmin().from('flota_fiscal')
      .select('rfc, razon_social, regimen_fiscal, lugar_expedicion, serie, modo')
      .eq('tenant_id', tenantId).maybeSingle(), 'timbrado.perfil');
    if (error) throw new Error(error.message);
    perfil = (data ?? null) as Record<string, unknown> | null;
  } catch (e) {
    leyoOk = false;
    logger.warn('timbrado.perfil_no_leido', { tenantId, err: e instanceof Error ? e.message : String(e) });
  }

  async function guardar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantEfectivo('/dashboard/contador', searchParams);
    if (!puedeVerRuta(s.rol, '/dashboard/contador')) {
      return { error: 'Tu rol no puede declarar el perfil fiscal del timbrado.' };
    }
    try {
      await guardarPerfilFiscal(s.tenantId, {
        rfc: t(fd.get('rfc'))?.toUpperCase() ?? null,
        razonSocial: t(fd.get('razonSocial')),
        regimenFiscal: t(fd.get('regimenFiscal')),
        lugarExpedicion: t(fd.get('lugarExpedicion')),
        serie: t(fd.get('serie')),
        modo: String(fd.get('modo')) === 'produccion' ? 'produccion' : 'sandbox',
      }, { id: s.userId });
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar el perfil de timbrado') };
    }
    revalidatePath('/dashboard/contador');
    return { ok: 'Perfil de timbrado guardado. El botón «Timbrar» del borrador de Carta Porte lo usa tal cual.' };
  }

  const modoActual = perfil?.modo === 'produccion' ? 'produccion' : 'sandbox';

  return (
    <section className="space-y-3">
      <header className="flex items-center gap-2">
        <Stamp size={15} style={{ color: 'var(--marca)' }} aria-hidden />
        <h2 className="font-display text-[15px] font-semibold">Timbrado (Carta Porte vía PAC)</h2>
      </header>

      <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
        {pac.configurado
          ? `PAC conectado: ${pac.proveedor?.toUpperCase()} — ambiente ${pac.pareceSandbox ? 'de PRUEBAS (los timbres no amparan nada)' : 'de PRODUCCIÓN'}.`
          : 'Sin PAC configurado: el timbrado está apagado. Se enciende con las variables LIKIDA_PAC_* en el servidor (contrato con el PAC + credenciales) — sin eso, Likida no timbra y jamás simula un timbre.'}
        {' '}El CSD de la flota vive en la bóveda del PAC (se carga en SU portal), nunca en Likida.
      </p>

      {/* 0227 (auditoría Fable c6-3): el camino del contador AL BOTÓN. Antes
          el único acceso al timbre era el borrador de Carta Porte, que es del
          área `operacion` — o sea, la pantalla donde este rol rebota. Declarar
          el perfil aquí y no poder usarlo era la mitad de un flujo. */}
      <p className="text-[12.5px]">
        <Link href={`/dashboard/timbrado${sufijo}`} className="font-medium hover:opacity-75" style={{ color: 'var(--marca)' }}>
          Ir a la cola de Timbrado →
        </Link>
        <span style={{ color: 'var(--muted)' }}>
          {' '}Ahí se emite el CFDI de cada viaje con su complemento. El borrador (los 37 datos y la
          declaración de ruta) lo trabaja el jefe de tráfico en Carta Porte; emitirlo es de este lado.
        </span>
      </p>

      {!leyoOk ? (
        <p className="text-[12.5px]" style={{ color: 'var(--warn)' }}>
          No se pudo leer el perfil guardado — reintenta antes de capturar encima.
        </p>
      ) : (
        <FormaConAviso accion={guardar} boton="Declarar mi perfil fiscal" columnas="md:grid-cols-3">
          <Campo nombre="rfc" etiqueta="RFC del emisor" valorInicial={String(perfil?.rfc ?? '')} placeholder="EKU9003173C9 (el de pruebas del SAT, en sandbox)" />
          <Campo nombre="razonSocial" etiqueta="Razón social (exacta a la constancia)" valorInicial={String(perfil?.razon_social ?? '')} placeholder="ESCUELA KEMPER URGATE" />
          <Campo nombre="regimenFiscal" etiqueta="Régimen fiscal (clave)" valorInicial={String(perfil?.regimen_fiscal ?? '')} placeholder="601" />
          <Campo nombre="lugarExpedicion" etiqueta="CP de expedición" valorInicial={String(perfil?.lugar_expedicion ?? '')} placeholder="42501" />
          <Campo nombre="serie" etiqueta="Serie (opcional)" valorInicial={String(perfil?.serie ?? '')} placeholder="CCP" />
          <Selector nombre="modo" etiqueta="Ambiente" valorInicial={modoActual} opciones={[
            { valor: 'sandbox', texto: 'Sandbox — timbres de prueba' },
            { valor: 'produccion', texto: 'Producción — timbres fiscales reales' },
          ]} />
        </FormaConAviso>
      )}
    </section>
  );
}
