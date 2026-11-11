import { getT } from '@/lib/i18n/servidor';
import { rico } from '@/lib/i18n/rico';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoAccion, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { cambioFiscalExigeStepUp, exigirStepUpAccion } from '@/lib/auth/stepup';
import { estadoPac } from '@/lib/likida/pac';
import { guardarPerfilFiscal } from '@/lib/likida/carta_porte_timbre';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { logger } from '@/lib/logger';
import { AvisoCompacto, BotonEnlace, CamposSistema, CampoSelect, CampoTexto, Fieldset, FormaConAviso, Tarjeta, type ResultadoAccion } from '@/app/ui-v2/componentes';
import './contador.css';

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
  const { t: tr } = await getT('dinero');
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
    const { t: tr, idioma } = await getT('dinero');
    const s = await resolverTenantAtadoAccion('/dashboard/contador', searchParams, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, '/dashboard/contador')) {
      return { error: tr('contador.timbrado.tuRolNoPuede') };
    }
    const nuevo = {
      rfc: t(fd.get('rfc'))?.toUpperCase() ?? null,
      razonSocial: t(fd.get('razonSocial')),
      regimenFiscal: t(fd.get('regimenFiscal')),
      lugarExpedicion: t(fd.get('lugarExpedicion')),
      serie: t(fd.get('serie')),
      modo: String(fd.get('modo')) === 'produccion' ? 'produccion' as const : 'sandbox' as const,
    };
    // R7-A3: cambiar el RFC o pasar a producción exige segundo factor reciente. Se compara contra lo GUARDADO ahora (no contra lo
    // que pintó la pantalla: otra pestaña pudo cambiarlo) y, si no se pudo leer, se cierra.
    let vigente: { rfc?: string | null; modo?: string | null } | null | undefined;
    try {
      const { data, error } = await acotada(supabaseAdmin().from('flota_fiscal').select('rfc, modo').eq('tenant_id', s.tenantId).maybeSingle(), 'timbrado.perfil_vigente');
      vigente = error ? undefined : (data as { rfc?: string | null; modo?: string | null } | null);
    } catch {
      vigente = undefined;
    }
    if (cambioFiscalExigeStepUp(vigente, nuevo)) {
      const pasoMfa = await exigirStepUpAccion(s.rol, 'perfil_fiscal', { tenantId: s.tenantId, userId: s.userId });
      if (pasoMfa) return { error: pasoMfa };
    }
    try {
      await guardarPerfilFiscal(s.tenantId, nuevo, { id: s.userId });
    } catch (e) {
      return { error: mensajeParaPantalla(e, tr('contador.timbrado.operacionGuardar'), idioma) };
    }
    revalidatePath('/dashboard/contador');
    return { ok: tr('contador.timbrado.perfilDeTimbradoGuardado') };
  }

  const modoActual = perfil?.modo === 'produccion' ? 'produccion' : 'sandbox';

  return (
    <Tarjeta titulo={tr('contador.timbrado.timbradoCartaPorteVia')}>
      <div className="rv-cont__lista">
      {pac.configurado ? (
        <CamposSistema etiqueta={tr('contador.timbrado.estadoDelPac')} campos={[
          { etiqueta: 'PAC conectado', valor: String(pac.proveedor ?? '').toUpperCase() },
          { etiqueta: 'Ambiente', valor: pac.pareceSandbox ? 'Pruebas' : tr('contador.timbrado.produccion'), nota: pac.pareceSandbox ? tr('contador.timbrado.losTimbresNoAmparan') : 'Timbres fiscales reales.' },
          { etiqueta: tr('contador.timbrado.csdDeLaFlota'), valor: tr('contador.timbrado.enLaBovedaDel'), nota: tr('contador.timbrado.seCargaEnSu') },
        ]} />
      ) : (
        <p className="rv-cont__linea">
          {tr('contador.timbrado.sinPacConfiguradoEl')}
        </p>
      )}

      {/* 0227 (auditoría Fable c6-3): el camino del contador AL BOTÓN. Antes
          el único acceso al timbre era el borrador de Carta Porte, que es del
          área `operacion` — o sea, la pantalla donde este rol rebota. Declarar
          el perfil aquí y no poder usarlo era la mitad de un flujo. */}
      <p className="rv-cont__linea">
        {rico(tr('contador.timbrado.botonenlaceIrALa'), { botonenlace: (c) => <BotonEnlace href={`/dashboard/timbrado${sufijo}`} variante="secondary" tamano="sm">{c}</BotonEnlace> })}
      </p>

      {!leyoOk ? (
        <AvisoCompacto tono="warn" resumen={tr('contador.timbrado.noSePudoLeer')} />
      ) : (
        <FormaConAviso accion={guardar} boton="Declarar mi perfil fiscal" columnas="md:grid-cols-1">
          <Fieldset leyenda={tr('contador.timbrado.emisor')}>
            <div className="rv-forma__rejilla">
              <CampoTexto id="rfc" name="rfc" etiqueta={tr('contador.timbrado.rfcDelEmisor')} defaultValue={String(perfil?.rfc ?? '')} placeholder={tr('contador.timbrado.eku9003173c9ElDePruebas')} />
              <CampoTexto id="razonSocial" name="razonSocial" etiqueta={tr('contador.timbrado.razonSocialExactaA')} defaultValue={String(perfil?.razon_social ?? '')} placeholder={tr('contador.timbrado.escuelaKemperUrgate')} />
              <CampoTexto id="regimenFiscal" name="regimenFiscal" etiqueta={tr('contador.timbrado.regimenFiscalClave')} defaultValue={String(perfil?.regimen_fiscal ?? '')} placeholder="601" />
              <CampoTexto id="lugarExpedicion" name="lugarExpedicion" etiqueta={tr('contador.timbrado.cpDeExpedicion')} defaultValue={String(perfil?.lugar_expedicion ?? '')} placeholder="42501" />
            </div>
          </Fieldset>
          <Fieldset leyenda={tr('contador.timbrado.emision')}>
            <div className="rv-forma__rejilla">
              <CampoTexto id="serie" name="serie" etiqueta={tr('contador.timbrado.serieOpcional')} defaultValue={String(perfil?.serie ?? '')} placeholder="CCP" />
              <CampoSelect id="modo" name="modo" etiqueta={tr('contador.timbrado.ambiente')} defaultValue={modoActual}>
                <option value="sandbox">{tr('contador.timbrado.sandboxTimbresDePrueba')}</option>
                <option value="produccion">{tr('contador.timbrado.produccionTimbresFiscalesRea')}</option>
              </CampoSelect>
            </div>
          </Fieldset>
        </FormaConAviso>
      )}
      </div>
    </Tarjeta>
  );
}
