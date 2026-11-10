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
export const metadata: Metadata = { title: 'Políticas de gasto' };

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
    // A37-S20-02: el MISMO resolutor que la página (con `sp`): `?vista=demo`,
    // `?tenant=` y la cookie del selector se resuelven igual al pintar y al
    // guardar. Antes la action leía solo la sesión y, con `?vista=demo`,
    // escribía la política de la demo en la flota elegida en el selector.
    const s = await resolverTenantAtadoOLanza('/dashboard/politicas', sp, tenantId);
    if (!puedeAdministrar(s.rol)) {
      return { error: 'Tu rol no puede editar la política de gastos.' };
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
      ok: `Política guardada: ${propios} concepto(s) con regla${porRutaVigente.length > 0 ? `, más ${porRutaVigente.length} por ruta que se conservaron` : ''}. El motor la aplica desde el próximo cuadre.`,
    };
  }

  const columnasEditor: ColumnaBase<(typeof CONCEPTOS)[number]>[] = [
    { id: 'concepto', titulo: 'Concepto', principal: true, celda: (c) => etiquetaConcepto(c) },
    {
      id: 'tope', titulo: 'Tope por comprobante (MXN)',
      celda: (c) => (
        <CampoTexto
          id={`tope_${c}`}
          name={`tope_${c}`}
          tipo="number"
          step="0.01"
          min="0"
          etiqueta={`Tope de ${etiquetaConcepto(c)}`}
          etiquetaOculta
          defaultValue={deConcepto(c)?.topeMonto ?? ''}
          placeholder="Sin tope"
          className="rv-pol__tope"
        />
      ),
    },
    {
      id: 'cfdi', titulo: 'Exige factura (CFDI)',
      celda: (c) => (
        <Casilla
          id={`cfdi_${c}`}
          name={`cfdi_${c}`}
          etiqueta={`Exigir CFDI para ${etiquetaConcepto(c)}`}
          defaultChecked={deConcepto(c)?.requiereCfdi ?? false}
        />
      ),
    },
  ];
  const columnasLectura: ColumnaBase<PoliticaGasto>[] = [
    { id: 'concepto', titulo: 'Concepto', principal: true, celda: (p) => etiquetaConcepto(p.concepto) },
    { id: 'tope', titulo: 'Tope por comprobante', alinear: 'der', celda: (p) => (p.topeMonto === undefined ? <span className="rv-pol__sin">Sin tope</span> : mxn(p.topeMonto)) },
    { id: 'cfdi', titulo: 'Exige factura (CFDI)', celda: (p) => (p.requiereCfdi ? <StatusChip tono="warn">Sí</StatusChip> : <span className="rv-pol__sin">No</span>) },
  ];
  const columnasRuta: ColumnaBase<PoliticaGasto>[] = [
    { id: 'concepto', titulo: 'Concepto', principal: true, celda: (p) => etiquetaConcepto(p.concepto) },
    { id: 'ruta', titulo: 'Ruta', celda: (p) => p.ruta },
    { id: 'tope', titulo: 'Tope', alinear: 'der', celda: (p) => (p.topeMonto === undefined ? '—' : mxn(p.topeMonto)) },
  ];

  return (
    <MarcoPagina titulo="Configuración" apoyo="Los topes contra los que el motor cuadra cada viaje de tu flota.">
      {config === null ? (
        <EstadoError reintentar>No se pudo leer la configuración de esta flota.</EstadoError>
      ) : (
        <>
          <Tarjeta
            titulo="Topes por concepto" info="politicas.topes"
            acciones={politicaPropiaFalloLectura ? (
              <StatusChip tono="warn">No se pudo saber si es propia</StatusChip>
            ) : (
              !politicaPropia && <StatusChip tono="neutral">Heredada de la base</StatusChip>
            )}
          >
            {puedeEditar ? (
              <>
                <FormaConAviso accion={accionGuardar} boton="Guardar política" columnas="md:grid-cols-1">
                  <TablaBase<(typeof CONCEPTOS)[number]> etiqueta="Topes por comprobante (MXN)" columnas={columnasEditor} filas={CONCEPTOS}
                    idFila={(c) => c} altoMaximo={false} />
                </FormaConAviso>
                <p className="rv-pol__nota">
                  Vacío es <strong>sin tope</strong>; un 0 es <strong>tope de cero</strong>: el concepto deja de
                  permitirse. No es lo mismo y el motor los trata distinto.
                  {politicaPropiaFalloLectura
                    ? ' No se pudo leer si esta flota ya tiene su propia política o sigue la base: recarga antes de decidir si hace falta guardar.'
                    : !politicaPropia && ' Esta flota todavía usa la política base: al guardar queda con la suya y deja de seguirla.'}
                </p>
              </>
            ) : politica.length === 0 ? (
              <EstadoVacio titulo="Sin topes configurados" contenido>
                Esta flota no tiene topes configurados: el motor no marcará nada por política.
              </EstadoVacio>
            ) : (
              <TablaBase<PoliticaGasto> etiqueta="Topes por comprobante por concepto" columnas={columnasLectura} filas={politica}
                idFila={(p) => `${p.concepto}-${p.ruta ?? ''}`} altoMaximo={false} />
            )}
          </Tarjeta>

          {porRuta.length > 0 && (
            <Tarjeta titulo="Reglas por ruta" info="politicas.reglas_ruta">
              {/* H39 (auditoría 24): con nombres de ruta largos en un celular la fila se cortaba sin forma de deslizar; la región de TablaBase desliza y se alcanza con teclado. */}
              <TablaBase<PoliticaGasto> etiqueta="Reglas por ruta" columnas={columnasRuta} filas={porRuta}
                idFila={(p) => `${p.concepto}-${p.ruta}`} altoMaximo={false} />
              <p className="rv-pol__nota">
                De solo lectura: el editor de arriba trabaja por concepto y no tiene dónde poner la ruta. Se conservan
                intactas al guardar; no se editan desde aquí todavía.
              </p>
            </Tarjeta>
          )}

          <Tarjeta titulo="Topes fiscales que aplica el motor" info="politicas.topes_fiscales">
            <CamposSistema etiqueta="Topes fiscales" campos={[
              { etiqueta: 'Tope diario de alimentación nacional', valor: mxn(config.estimulos.viaticosTopeFiscalDiarioMxn), nota: 'LISR Art. 28-V. Lo que exceda sale marcado como no deducible.' },
              { etiqueta: 'Tope de gasto en efectivo (no combustible)', valor: mxn(config.estimulos.efectivoTopeMxn), nota: 'LISR Art. 27-III. Arriba de esto exige otra forma de pago.' },
              { etiqueta: 'Peaje acreditable', valor: `${Math.round(config.estimulos.peajeFactor * 100)}%`, nota: 'Estímulo de autopistas, LIF 2026 Art. 20-A, sujeto a elegibilidad.' },
              { etiqueta: 'Desviación de consumo', valor: `${Math.round(config.tabulador.umbralDesviacion * 100)}%`, nota: 'A partir de aquí el motor levanta la mano.' },
            ]} />
          </Tarjeta>

          <AvisoCompacto tono="info"
            resumen="Los topes fiscales de arriba NO se editan desde aquí: los fija la ley, no la flota."
            mas="Los viáticos por ruta/día y el plazo de comprobación del anticipo tampoco están en el esquema como reglas configurables." />
        </>
      )}
    </MarcoPagina>
  );
}
