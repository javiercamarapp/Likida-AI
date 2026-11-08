import { revalidatePath } from 'next/cache';
import { FileSpreadsheet, Download } from 'lucide-react';
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
import { FormaConAviso, type ResultadoAccion } from '../../admin/ui/forma';
import { CampoSelect, CampoTexto, Disclosure } from '@/app/ui-v2/componentes';

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

function EstadoPerfil({ etiqueta, perfil, leyoOk }: { etiqueta: string; perfil: PerfilExportacionErp | null; leyoOk: boolean }) {
  return (
    <p className="text-xs" style={{ color: 'var(--muted)' }}>
      <span className="font-medium">{etiqueta}:</span>{' '}
      {!leyoOk
        ? 'no pude leer si ya hay plantilla confirmada — recarga antes de confirmar de nuevo.'
        : perfil
          ? `plantilla confirmada el ${fechaMx(perfil.confirmadoEn)}. El export ya usa este layout; volver a enviar la reemplaza.`
          : 'sin plantilla confirmada — el export de póliza en este formato responde 409 hasta confirmarla.'}
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
function BotonPoliza({ sufijo, hoy }: { sufijo: string; hoy: string }) {
  // El sufijo del superadmin (`?tenant=`, `?vista=`, `?rol=`) tiene que
  // viajar o el CSV saldría de la flota equivocada. Tercer dialecto del
  // repo: `${sufijo}${sufijo ? '&' : '?'}`, igual que el botón de arriba.
  const href = `/api/export/poliza${sufijo}${sufijo ? '&' : '?'}formato=contpaqi&desde=${hoy.slice(0, 8)}01&hasta=${hoy}`;
  return (
    <a href={href} download
      className="hairline inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)]"
      style={{ background: 'var(--surface)' }}>
      <Download width={13} height={13} strokeWidth={1.75} />
      Descargar póliza del mes (CSV CONTPAQi)
    </a>
  );
}

export async function PerfilErp({
  searchParams,
  tenantExiste,
}: {
  searchParams: { vista?: string; tenant?: string; rol?: string };
  tenantExiste: boolean;
}) {
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
    const s = await resolverTenantAtadoAccion('/dashboard/contador', searchParams, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, '/dashboard/contador')) {
      return { error: 'Tu rol no puede confirmar la plantilla de exportación contable.' };
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
    return { ok: 'Plantilla CONTPAQi confirmada. El export de póliza ya entrega este layout.' };
  }

  async function confirmarSapB1(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantAtadoAccion('/dashboard/contador', searchParams, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, '/dashboard/contador')) {
      return { error: 'Tu rol no puede confirmar la plantilla de exportación contable.' };
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
    return { ok: 'Plantilla SAP Business One (DTW) confirmada. El export de póliza ya entrega este layout.' };
  }

  const sapInicial = sapB1?.sistema === 'sap_b1' ? sapB1.plantilla : SAP_B1_BASE;
  const cpInicial = contpaqi?.sistema === 'contpaqi'
    ? contpaqi.opciones
    : { tipo: 'Dr', numero: 1, separador: ',' as const, encabezado: [...ENCABEZADO_CONTPAQI] };

  return (
    <section
      className="mt-3 rounded-2xl px-5 py-4 flex flex-col gap-4 hairline"
      style={{ background: 'var(--surface)' }}
    >
      <div className="flex items-start gap-2.5">
        <FileSpreadsheet width={16} height={16} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--muted)' }} />
        <div className="min-w-0">
          <p className="text-sm font-medium">Plantilla de exportación contable (CONTPAQi / SAP Business One)</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            El export de la póliza usa el layout EXACTO que tu instancia importa — no hay una
            plantilla universal segura entre versiones. Confirmarla aquí significa que la
            contrastaste contra el esquema de importación de tu CONTPAQi o tu Data Transfer
            Workbench de SAP B1. Los campos vienen prellenados con la base común solo para no
            teclear desde cero.
          </p>
          <div className="mt-1.5 flex flex-col gap-0.5">
            <EstadoPerfil etiqueta="CONTPAQi" perfil={contpaqi} leyoOk={leyoOk} />
            <EstadoPerfil etiqueta="SAP Business One" perfil={sapB1} leyoOk={leyoOk} />
          </div>

          {/* El botón solo con plantilla CONTPAQi confirmada Y con permiso de
              exportar: sin lo primero la ruta contesta 409, y sin lo segundo
              403. Ofrecerlo igual mandaría al contador a un error en vez de a
              un archivo. La puerta REAL sigue estando en la ruta. */}
          {leyoOk && contpaqi !== null && puedeExportar(rol) && (
            <div className="mt-2.5">
              <BotonPoliza sufijo={sufijoTenant(searchParams)} hoy={hoyMx(new Date(ahoraMs()))} />
              <p className="text-xs mt-1" style={{ color: 'var(--faint)' }}>
                El asiento del mes en curso, con el layout que confirmaste. SAP Business One no
                baja como archivo —su plantilla DTW son dos .txt que la ruta entrega en JSON—;
                se pide desde la integración, no desde aquí.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Mismo criterio que estimulo-peaje: sin lectura confiable no se ofrece
          el formulario — confirmaría a ciegas encima de una plantilla real. */}
      {leyoOk && (
        <>
          <Disclosure titulo="CONTPAQi — confirmar plantilla">
            {/* Una sola columna para el encabezado de 9 columnas: necesita todo el ancho; los tres campos cortos van en rejilla. */}
            <FormaConAviso accion={confirmarContpaqi} boton="Confirmar contra mi instancia" columnas="md:grid-cols-1">
              <div className="rv-forma__rejilla">
                <CampoSelect id="tipo" name="tipo" etiqueta="Tipo de póliza" obligatorio defaultValue={cpInicial.tipo}>
                  <option value="Dr">Dr — diario</option>
                  <option value="Ig">Ig — ingreso</option>
                  <option value="Eg">Eg — egreso</option>
                </CampoSelect>
                <CampoSelect id="separador" name="separador" etiqueta="Separador del archivo" obligatorio defaultValue={cpInicial.separador ?? ','}>
                  <option value=",">Coma (,)</option>
                  <option value={'\t'}>Tabulador</option>
                  <option value="|">Barra vertical (|)</option>
                </CampoSelect>
              </div>
              <CampoTexto id="numeroInicial" name="numeroInicial" tipo="number" step="0.01" min="0" etiqueta="Número inicial de póliza" obligatorio
                defaultValue={String(cpInicial.numero)}
                ayuda="Lo asigna tu contabilidad; cada póliza del archivo incrementa desde aquí." />
              <CampoTexto id="encabezado" name="encabezado" etiqueta="Encabezado del esquema (9 columnas separadas por coma)" obligatorio
                defaultValue={(cpInicial.encabezado ?? [...ENCABEZADO_CONTPAQI]).join(', ')}
                ayuda="Debe coincidir con el esquema de importación de TU CONTPAQi, no con este ejemplo." />
            </FormaConAviso>
          </Disclosure>

          <Disclosure titulo="SAP Business One (DTW) — confirmar plantilla">
            <FormaConAviso accion={confirmarSapB1} boton="Confirmar contra mi instancia" columnas="md:grid-cols-1">
              <div className="rv-forma__rejilla">
                <CampoTexto id="cabeceraTecnica" name="cabeceraTecnica" etiqueta="Cabecera — fila técnica (columnas separadas por coma)" obligatorio
                  defaultValue={sapInicial.cabeceraTecnica.join(', ')}
                  ayuda="La primera fila de la plantilla DTW de asientos (JournalEntries) de TU instancia." />
                <CampoTexto id="cabeceraVisible" name="cabeceraVisible" etiqueta="Cabecera — fila descriptiva" obligatorio
                  defaultValue={sapInicial.cabeceraVisible.join(', ')}
                  ayuda="La segunda fila de esa misma plantilla. Debe tener las mismas columnas que la técnica." />
                <CampoTexto id="lineasTecnica" name="lineasTecnica" etiqueta="Líneas — fila técnica" obligatorio
                  defaultValue={sapInicial.lineasTecnica.join(', ')}
                  ayuda="La primera fila de la plantilla DTW de líneas (JournalEntries_Lines)." />
                <CampoTexto id="lineasVisible" name="lineasVisible" etiqueta="Líneas — fila descriptiva" obligatorio
                  defaultValue={sapInicial.lineasVisible.join(', ')} />
              </div>
            </FormaConAviso>
          </Disclosure>
        </>
      )}
    </section>
  );
}
