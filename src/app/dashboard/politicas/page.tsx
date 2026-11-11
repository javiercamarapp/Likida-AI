import { getT } from '@/lib/i18n/servidor';
import { rico } from '@/lib/i18n/rico';
import { revalidatePath } from 'next/cache';
import { getConfig } from '@/lib/likida/config';
import { etiquetaConcepto } from '@/lib/likida/cuadre/engine';
import { guardarPolitica, armarPolitica, mensajeParaPantalla } from '@/lib/likida/administracion';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Metadata } from 'next';
import {
  AvisoCompacto, CamposSistema, CampoTexto, Casilla, EstadoError, EstadoVacio, FormaConAviso, MarcoPagina, StatusChip, TablaBase, Tarjeta,
  type ColumnaBase, type ResultadoAccion,
} from '@/app/ui-v2/componentes';
import type { PoliticaGasto } from '@/lib/likida/cuadre/engine';
import './politicas.css';
export async function generateMetadata(): Promise<Metadata> {
  const { t: tr } = await getT('dinero');
  return { title: tr('meta.politicas') };
}

export const dynamic = 'force-dynamic';

/** Los conceptos que el motor sabe etiquetar (`label()` en engine.ts). Un
 *  concepto fuera de esta lista no rompe nada, pero tampoco tiene renglón: por
 *  eso los que ya estén guardados se conservan aunque no aparezcan aquí. */
const CONCEPTOS = ['diesel', 'caseta', 'factura', 'alimentacion', 'hospedaje', 'transporte', 'flete', 'viaticos', 'otro'] as const;

/**
 * Políticas (PASO 23) — los topes REALES contra los que el motor cuadra cada
 * viaje de esta flota, leídos de `tenant.config.politica` con `getConfig()`,
 * que es la misma función que usa el motor. No es una pantalla informativa:
 * es la regla que decide si un gasto sale marcado.
 *
 * `politica_gasto` (la tabla) NO se lee aquí a propósito: está MUERTA — su
 * propio comentario en el esquema lo dice, no la lee nadie. Enseñarla haría
 * que el dueño edite mentalmente una regla que el motor no aplica.
 *
 * SE PUEDE EDITAR DESDE AQUÍ (antes se cambiaba con SQL a mano). Dos cuidados
 * que no son obvios:
 *
 *  1. `fusionarConfig` REEMPLAZA los arreglos completos, no los fusiona renglón
 *     por renglón. Así que lo que se guarda es la política entera, y por eso el
 *     formulario tiene que mandar TODOS los renglones vigentes, no solo el que
 *     se tocó.
 *  2. Por (1), las reglas POR RUTA se perderían: este formulario se indexa por
 *     concepto y no tiene dónde ponerlas. Se conservan aparte, verbatim, y se
 *     enseñan como de solo lectura. Borrarle a una flota su tope de casetas de
 *     una ruta concreta —en silencio, por guardar otra cosa— es el tipo de daño
 *     que nadie relaciona con esta pantalla tres semanas después.
 */
export default async function PoliticasPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string }>;
}) {
  const { t: tr } = await getT('dinero');
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/politicas', sp);
  const puedeEditar = puedeAdministrar(rol);

  let config;
  try {
    config = await getConfig(tenantId);
  } catch {
    config = null;
  }

  // ¿La política que se ve es SUYA o la heredada de la base? `getConfig` ya las
  // fusionó y no lo distingue, así que se pregunta por la fila cruda. Importa
  // decirlo: al guardar por primera vez, la flota deja de seguir la base.
  //
  // H35 (auditoría 24): esta lectura no comprobaba `error` — una consulta
  // caída se leía IGUAL que "no tiene política propia" (`data` undefined →
  // `Array.isArray(undefined)` → `false`), y la pantalla afirmaba «Heredada
  // de la base» sobre una flota que quizás SÍ tiene la suya: no es lo mismo
  // «no se pudo saber» que «usa la de la base», y la primera lectura, mal
  // etiquetada como la segunda, empuja al dueño a guardar de nuevo creyendo
  // que apenas está declarando su primera política.
  let politicaPropia = false;
  let politicaPropiaFalloLectura = false;
  if (config) {
    const { data, error } = await supabaseAdmin().from('tenant').select('config').eq('id', tenantId).maybeSingle();
    if (error) {
      politicaPropiaFalloLectura = true;
    } else {
      const cfg = data?.config as { politica?: unknown } | null;
      politicaPropia = Array.isArray(cfg?.politica);
    }
  }

  const politica = config?.politica ?? [];
  const porRuta = politica.filter((p) => p.ruta);
  const generales = politica.filter((p) => !p.ruta);
  const deConcepto = (c: string) => generales.find((p) => p.concepto === c);

  async function accionGuardar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    // A37-S20-02: el MISMO resolutor que la página (con `sp`): `?vista=demo`,
    // `?tenant=` y la cookie del selector se resuelven igual al pintar y al
    // guardar. Antes la action leía solo la sesión y, con `?vista=demo`,
    // escribía la política de la demo en la flota elegida en el selector.
    const s = await resolverTenantAtadoOLanza('/dashboard/politicas', sp, tenantId);
    if (!puedeAdministrar(s.rol)) {
      return { error: tr('politicas.page.tuRolNoPuede') };
    }
    const t = s.tenantId;

    // `armarPolitica` repone las reglas por ruta, que este formulario no edita
    // y que guardar sin ellas borraría. Vive en administracion.ts porque puede
    // perder datos y eso tiene que estar probado, no confiado a la vista.
    let completa;
    let porRutaVigente: ReturnType<typeof armarPolitica> = [];
    try {
      // A37-S20-02: las reglas por ruta se releen AQUÍ, de la flota que se va a
      // escribir — la copia del render puede estar obsoleta si otra sesión las
      // cambió, y guardar con ella las borraría o resucitaría en silencio.
      const vigente = await getConfig(t);
      porRutaVigente = vigente.politica.filter((p) => p.ruta);
      completa = armarPolitica(
        CONCEPTOS.map((c) => ({
          concepto: c,
          tope: String(fd.get(`tope_${c}`) ?? ''),
          exigeCfdi: fd.get(`cfdi_${c}`) === 'on',
        })),
        porRutaVigente,
      );
      await guardarPolitica(t, completa);
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar la política') };
    }

    revalidatePath('/dashboard/politicas');
    const propios = completa.length - porRutaVigente.length;
    return {
      ok: tr('politicas.page.politicaGuardadaConceptoS', { propios, v: porRutaVigente.length > 0 ? tr('politicas.page.masPorRutaQue', { length: porRutaVigente.length }) : '' }),
    };
  }

  const columnasEditor: ColumnaBase<(typeof CONCEPTOS)[number]>[] = [
    { id: 'concepto', titulo: tr('politicas.page.concepto'), principal: true, celda: (c) => etiquetaConcepto(c) },
    {
      id: 'tope', titulo: tr('politicas.page.topePorComprobanteMxn'),
      celda: (c) => (
        <CampoTexto
          id={`tope_${c}`}
          name={`tope_${c}`}
          tipo="number"
          step="0.01"
          min="0"
          etiqueta={tr('politicas.page.topeDe', { concepto: etiquetaConcepto(c) })}
          etiquetaOculta
          defaultValue={deConcepto(c)?.topeMonto ?? ''}
          placeholder={tr('politicas.page.sinTope')}
          className="rv-pol__tope"
        />
      ),
    },
    {
      id: 'cfdi', titulo: tr('politicas.page.exigeFacturaCfdi'),
      celda: (c) => (
        <Casilla
          id={`cfdi_${c}`}
          name={`cfdi_${c}`}
          etiqueta={tr('politicas.page.exigirCfdiPara', { concepto: etiquetaConcepto(c) })}
          defaultChecked={deConcepto(c)?.requiereCfdi ?? false}
        />
      ),
    },
  ];
  const columnasLectura: ColumnaBase<PoliticaGasto>[] = [
    { id: 'concepto', titulo: tr('politicas.page.concepto'), principal: true, celda: (p) => etiquetaConcepto(p.concepto) },
    { id: 'tope', titulo: tr('politicas.page.topePorComprobante'), alinear: 'der', celda: (p) => (p.topeMonto === undefined ? <span className="rv-pol__sin">{tr('politicas.page.sinTope')}</span> : mxn(p.topeMonto)) },
    { id: 'cfdi', titulo: tr('politicas.page.exigeFacturaCfdi'), celda: (p) => (p.requiereCfdi ? <StatusChip tono="warn">{tr('politicas.page.si')}</StatusChip> : <span className="rv-pol__sin">{tr('politicas.page.no')}</span>) },
  ];
  const columnasRuta: ColumnaBase<PoliticaGasto>[] = [
    { id: 'concepto', titulo: tr('politicas.page.concepto'), principal: true, celda: (p) => etiquetaConcepto(p.concepto) },
    { id: 'ruta', titulo: tr('politicas.page.ruta'), celda: (p) => p.ruta },
    { id: 'tope', titulo: tr('politicas.page.tope'), alinear: 'der', celda: (p) => (p.topeMonto === undefined ? '—' : mxn(p.topeMonto)) },
  ];

  return (
    <MarcoPagina titulo={tr('politicas.page.configuracion')} apoyo={tr('politicas.page.losTopesContraLos')}>
      {config === null ? (
        <EstadoError reintentar>{tr('politicas.page.noSePudoLeer')}</EstadoError>
      ) : (
        <>
          <Tarjeta
            titulo={tr('politicas.page.topesPorConcepto')} info="politicas.topes"
            acciones={politicaPropiaFalloLectura ? (
              <StatusChip tono="warn">{tr('politicas.page.noSePudoSaber')}</StatusChip>
            ) : (
              !politicaPropia && <StatusChip tono="neutral">{tr('politicas.page.heredadaDeLaBase')}</StatusChip>
            )}
          >
            {puedeEditar ? (
              <>
                <FormaConAviso accion={accionGuardar} boton={tr('politicas.page.guardarPolitica')} columnas="md:grid-cols-1">
                  <TablaBase<(typeof CONCEPTOS)[number]> etiqueta={tr('politicas.page.topesPorComprobanteMxn')} columnas={columnasEditor} filas={CONCEPTOS}
                    idFila={(c) => c} altoMaximo={false} />
                </FormaConAviso>
                <p className="rv-pol__nota">
                  {rico(tr('politicas.page.vacioEsNota'), { strong: (c) => <strong>{c}</strong>, strong2: (c) => <strong>{c}</strong> })}
                  {politicaPropiaFalloLectura
                    ? ' ' + tr('politicas.page.noSePudoLeer2')
                    : !politicaPropia && ' ' + tr('politicas.page.estaFlotaTodaviaUsa')}
                </p>
              </>
            ) : politica.length === 0 ? (
              <EstadoVacio titulo={tr('politicas.page.sinTopesConfigurados')} contenido>
                {tr('politicas.page.estaFlotaNoTiene')}
              </EstadoVacio>
            ) : (
              <TablaBase<PoliticaGasto> etiqueta={tr('politicas.page.topesPorComprobantePor')} columnas={columnasLectura} filas={politica}
                idFila={(p) => `${p.concepto}-${p.ruta ?? ''}`} altoMaximo={false} />
            )}
          </Tarjeta>

          {porRuta.length > 0 && (
            <Tarjeta titulo={tr('politicas.page.reglasPorRuta')} info="politicas.reglas_ruta">
              {/* H39 (auditoría 24): con nombres de ruta largos en un celular la fila se cortaba sin forma de deslizar; la región de TablaBase desliza y se alcanza con teclado. */}
              <TablaBase<PoliticaGasto> etiqueta={tr('politicas.page.reglasPorRuta')} columnas={columnasRuta} filas={porRuta}
                idFila={(p) => `${p.concepto}-${p.ruta}`} altoMaximo={false} />
              <p className="rv-pol__nota">
                {tr('politicas.page.deSoloLecturaEl')}
              </p>
            </Tarjeta>
          )}

          <Tarjeta titulo={tr('politicas.page.topesFiscalesQueAplica')} info="politicas.topes_fiscales">
            <CamposSistema etiqueta={tr('politicas.page.topesFiscales')} campos={[
              { etiqueta: tr('politicas.page.topeDiarioDeAlimentacion'), valor: mxn(config.estimulos.viaticosTopeFiscalDiarioMxn), nota: tr('politicas.page.lisrArt28V') },
              { etiqueta: tr('politicas.page.topeDeGastoEn'), valor: mxn(config.estimulos.efectivoTopeMxn), nota: tr('politicas.page.lisrArt27Iii') },
              { etiqueta: 'Peaje acreditable', valor: `${Math.round(config.estimulos.peajeFactor * 100)}%`, nota: tr('politicas.page.estimuloDeAutopistasLif') },
              { etiqueta: tr('politicas.page.desviacionDeConsumo'), valor: `${Math.round(config.tabulador.umbralDesviacion * 100)}%`, nota: tr('politicas.page.aPartirDeAqui') },
            ]} />
          </Tarjeta>

          <AvisoCompacto tono="info"
            resumen={tr('politicas.page.losTopesFiscalesDe')}
            mas={tr('politicas.page.losViaticosPorRuta')} />
        </>
      )}
    </MarcoPagina>
  );
}
