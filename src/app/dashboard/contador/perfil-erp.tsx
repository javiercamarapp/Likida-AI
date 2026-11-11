import { getT } from '@/lib/i18n/servidor';
import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import { revalidatePath } from 'next/cache';
import { Download } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoAccion, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeExportar } from '@/lib/auth/permisos';
import { hoyMx, fechaMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { sufijoTenant } from '../sufijo';
import {
  guardarPerfilExportacionErp,
  perfilExportacionDeclarado,
  type PerfilExportacionErp,
} from '@/lib/likida/contabilidad/perfiles';
import { ENCABEZADO_CONTPAQI, SAP_B1_BASE } from '@/lib/likida/contabilidad/formatos';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { logger } from '@/lib/logger';
import { BotonEnlace, CampoSelect, CampoTexto, Disclosure, FormaConAviso, Icono, Tarjeta, type ResultadoAccion } from '@/app/ui-v2/componentes';
import './contador.css';

/**
 * PLAN MAESTRO 26-ago, sección B — el formulario que desbloquea el export a
 * SAP Business One / CONTPAQi.
 *
 * La tabla `erp_export_perfil` (0178) tenía lector y ruta cableados pero
 * ningún escritor: el export de póliza respondía 409 "pide a tu contador que
 * confirme una plantilla" y la confirmación no existía en ninguna pantalla.
 *
 * Vive en el panel del contador por la misma razón que la declaración del
 * estímulo de peaje: el dato es contable, la ruta es `dinero`, y quien puede
 * confirmar que una plantilla coincide con SU instancia es el contador, no
 * el encargado ni Likida.
 *
 * ENVIAR ES CONFIRMAR. Los campos vienen prellenados con la plantilla
 * canónica solo para no teclear desde cero — el acto de guardar declara que
 * el contador la contrastó contra el esquema de importación de su instancia
 * real (el mismo contrato que documenta el comentario de la tabla). Por eso
 * el botón no dice "Guardar": dice "Confirmar contra mi instancia".
 */

const listaDeColumnas = (v: FormDataEntryValue | null): string[] =>
  String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function EstadoPerfil({ etiqueta, perfil, leyoOk, tr = trEs }: { etiqueta: string; perfil: PerfilExportacionErp | null; leyoOk: boolean; tr?: Tr }) {
  return (
    <p className="rv-cont__linea">
      <strong>{etiqueta}:</strong>{' '}
      {!leyoOk
        ? tr('contador.perfilErp.noPudeLeerSi')
        : perfil
          ? tr('contador.perfilErp.plantillaConfirmadaElEl', { v: fechaMx(perfil.confirmadoEn) })
          : tr('contador.perfilErp.sinPlantillaConfirmadaEl')}
    </p>
  );
}

/**
 * EL BOTÓN DE DESCARGA DE LA PÓLIZA — el que faltaba (agosto-2026).
 *
 * `/api/export/poliza` existía, con sus guardas (área `dinero` +
 * `puedeExportar`) y sus 409 escritos, y NINGUNA pantalla lo enlazaba: la
 * única forma de bajar la póliza era teclear la URL a mano. Se pone aquí y no
 * en el encabezado por una razón concreta: éste es el único punto de la
 * pantalla donde YA se sabe si el endpoint va a responder 409 —lo dice
 * `perfilExportacionDeclarado`—, así que el botón solo aparece cuando de
 * verdad va a bajar un archivo.
 *
 * SOLO CONTPAQi. `formato=sap_b1` no devuelve una descarga: devuelve un JSON
 * con los dos archivos DTW adentro (`oJournalEntries.txt` y
 * `JournalEntries_Lines.txt`), y un `<a download>` bajaría ese JSON. Poner un
 * botón que entrega algo que SAP no importa sería peor que no ponerlo, así
 * que se dice en su lugar.
 *
 * El rango es el MES EN CURSO, el mismo truco que el export de liquidaciones
 * del encabezado (`desde=AAAA-MM-01`), y cabe de sobra en el tope de 92 días
 * que impone la ruta.
 */
function BotonPoliza({ sufijo, hoy, tr = trEs }: { sufijo: string; hoy: string; tr?: Tr }) {
  // El sufijo del superadmin (`?tenant=`, `?vista=`, `?rol=`) tiene que
  // viajar o el CSV saldría de la flota equivocada. Tercer dialecto del
  // repo: `${sufijo}${sufijo ? '&' : '?'}`, igual que el botón de arriba.
  const href = `/api/export/poliza${sufijo}${sufijo ? '&' : '?'}formato=contpaqi&desde=${hoy.slice(0, 8)}01&hasta=${hoy}`;
  return (
    <BotonEnlace href={href} download variante="secondary" tamano="sm" icono={<Icono icono={Download} />}>
      {tr('contador.perfilErp.descargarPolizaDelMes')}
    </BotonEnlace>
  );
}

export async function PerfilErp({
  searchParams,
  tenantExiste,
}: {
  searchParams: { vista?: string; tenant?: string; rol?: string };
  tenantExiste: boolean;
}) {
  const { t: tr } = await getT('dinero');
  if (!tenantExiste) return null;

  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/contador', searchParams);

  // El mismo patrón `leyoOk` que `estimulo-peaje.tsx` (FRONTEND-19C2-5): un
  // error de lectura NO es "sin plantilla", y confundirlos invita a
  // reconfirmar encima de una plantilla real.
  let contpaqi: PerfilExportacionErp | null = null;
  let sapB1: PerfilExportacionErp | null = null;
  let leyoOk = true;
  try {
    [contpaqi, sapB1] = await Promise.all([
      perfilExportacionDeclarado(tenantId, 'contpaqi'),
      perfilExportacionDeclarado(tenantId, 'sap_b1'),
    ]);
  } catch (e) {
    leyoOk = false;
    logger.warn('perfil_erp.no_leido', { tenantId, err: e instanceof Error ? e.message : String(e) });
  }

  async function confirmarContpaqi(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoAccion('/dashboard/contador', searchParams, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, '/dashboard/contador')) {
      return { error: tr('contador.perfilErp.tuRolNoPuede') };
    }
    const numero = Number(String(fd.get('numeroInicial') ?? ''));
    try {
      await guardarPerfilExportacionErp(s.tenantId, 'contpaqi', {
        tipo: String(fd.get('tipo') ?? ''),
        numeroInicial: numero,
        separador: String(fd.get('separador') ?? ''),
        encabezado: listaDeColumnas(fd.get('encabezado')),
      }, s.userId);
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'confirmar la plantilla CONTPAQi') };
    }
    revalidatePath('/dashboard/contador');
    return { ok: tr('contador.perfilErp.plantillaContpaqiConfirmadaE') };
  }

  async function confirmarSapB1(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoAccion('/dashboard/contador', searchParams, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, '/dashboard/contador')) {
      return { error: tr('contador.perfilErp.tuRolNoPuede') };
    }
    try {
      await guardarPerfilExportacionErp(s.tenantId, 'sap_b1', {
        cabeceraTecnica: listaDeColumnas(fd.get('cabeceraTecnica')),
        cabeceraVisible: listaDeColumnas(fd.get('cabeceraVisible')),
        lineasTecnica: listaDeColumnas(fd.get('lineasTecnica')),
        lineasVisible: listaDeColumnas(fd.get('lineasVisible')),
      }, s.userId);
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'confirmar la plantilla SAP B1') };
    }
    revalidatePath('/dashboard/contador');
    return { ok: tr('contador.perfilErp.plantillaSapBusinessOne') };
  }

  const sapInicial = sapB1?.sistema === 'sap_b1' ? sapB1.plantilla : SAP_B1_BASE;
  const cpInicial = contpaqi?.sistema === 'contpaqi'
    ? contpaqi.opciones
    : { tipo: 'Dr', numero: 1, separador: ',' as const, encabezado: [...ENCABEZADO_CONTPAQI] };

  return (
    <Tarjeta titulo={tr('contador.perfilErp.plantillaDeExportacionContab')}>
      <div className="rv-cont__lista">
        <p className="rv-cont__linea">
          {tr('contador.perfilErp.elExportDeLa')}
        </p>
        <EstadoPerfil tr={tr} etiqueta="CONTPAQi" perfil={contpaqi} leyoOk={leyoOk} />
        <EstadoPerfil tr={tr} etiqueta={tr('contador.perfilErp.sapBusinessOne')} perfil={sapB1} leyoOk={leyoOk} />

        {/* El botón solo con plantilla CONTPAQi confirmada Y con permiso de exportar: sin lo primero la ruta contesta 409, y sin lo segundo 403. Ofrecerlo igual mandaría al contador a un error en vez de a un archivo. La puerta REAL sigue estando en la ruta. */}
        {leyoOk && contpaqi !== null && puedeExportar(rol) && (
          <div className="rv-cont__lista">
            <div><BotonPoliza tr={tr} sufijo={sufijoTenant(searchParams)} hoy={hoyMx(new Date(ahoraMs()))} /></div>
            <p className="rv-cont__linea">
              {tr('contador.perfilErp.elAsientoDelMes')}
            </p>
          </div>
        )}
      {/* Mismo criterio que estimulo-peaje: sin lectura confiable no se ofrece
          el formulario — confirmaría a ciegas encima de una plantilla real. */}
      {leyoOk && (
        <>
          <Disclosure titulo={tr('contador.perfilErp.contpaqiConfirmarPlantilla')}>
            {/* Una sola columna para el encabezado de 9 columnas: necesita todo el ancho; los tres campos cortos van en rejilla. */}
            <FormaConAviso accion={confirmarContpaqi} boton="Confirmar contra mi instancia" columnas="md:grid-cols-1">
              <div className="rv-forma__rejilla">
                <CampoSelect id="tipo" name="tipo" etiqueta={tr('contador.perfilErp.tipoDePoliza')} obligatorio defaultValue={cpInicial.tipo}>
                  <option value="Dr">{tr('contador.perfilErp.drDiario')}</option>
                  <option value="Ig">{tr('contador.perfilErp.igIngreso')}</option>
                  <option value="Eg">{tr('contador.perfilErp.egEgreso')}</option>
                </CampoSelect>
                <CampoSelect id="separador" name="separador" etiqueta={tr('contador.perfilErp.separadorDelArchivo')} obligatorio defaultValue={cpInicial.separador ?? ','}>
                  <option value=",">{tr('contador.perfilErp.coma')}</option>
                  <option value={'\t'}>{tr('contador.perfilErp.tabulador')}</option>
                  <option value="|">{tr('contador.perfilErp.barraVertical')}</option>
                </CampoSelect>
              </div>
              <CampoTexto id="numeroInicial" name="numeroInicial" tipo="number" step="0.01" min="0" etiqueta={tr('contador.perfilErp.numeroInicialDePoliza')} obligatorio
                defaultValue={String(cpInicial.numero)}
                ayuda={tr('contador.perfilErp.loAsignaTuContabilidad')} />
              <CampoTexto id="encabezado" name="encabezado" etiqueta={tr('contador.perfilErp.encabezadoDelEsquema9')} obligatorio
                defaultValue={(cpInicial.encabezado ?? [...ENCABEZADO_CONTPAQI]).join(', ')}
                ayuda={tr('contador.perfilErp.debeCoincidirConEl')} />
            </FormaConAviso>
          </Disclosure>

          <Disclosure titulo={tr('contador.perfilErp.sapBusinessOneDtw')}>
            <FormaConAviso accion={confirmarSapB1} boton="Confirmar contra mi instancia" columnas="md:grid-cols-1">
              <div className="rv-forma__rejilla">
                <CampoTexto id="cabeceraTecnica" name="cabeceraTecnica" etiqueta={tr('contador.perfilErp.cabeceraFilaTecnicaColumnas')} obligatorio
                  defaultValue={sapInicial.cabeceraTecnica.join(', ')}
                  ayuda={tr('contador.perfilErp.laPrimeraFilaDe')} />
                <CampoTexto id="cabeceraVisible" name="cabeceraVisible" etiqueta={tr('contador.perfilErp.cabeceraFilaDescriptiva')} obligatorio
                  defaultValue={sapInicial.cabeceraVisible.join(', ')}
                  ayuda={tr('contador.perfilErp.laSegundaFilaDe')} />
                <CampoTexto id="lineasTecnica" name="lineasTecnica" etiqueta={tr('contador.perfilErp.lineasFilaTecnica')} obligatorio
                  defaultValue={sapInicial.lineasTecnica.join(', ')}
                  ayuda={tr('contador.perfilErp.laPrimeraFilaDe2')} />
                <CampoTexto id="lineasVisible" name="lineasVisible" etiqueta={tr('contador.perfilErp.lineasFilaDescriptiva')} obligatorio
                  defaultValue={sapInicial.lineasVisible.join(', ')} />
              </div>
            </FormaConAviso>
          </Disclosure>
        </>
      )}
      </div>
    </Tarjeta>
  );
}
