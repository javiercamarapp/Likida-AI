import { getT } from '@/lib/i18n/servidor';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoAccion, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import {
  calificaEstimuloPeaje,
  preguntaPendienteEstimuloPeaje,
  umbralPeajeDeclarado,
} from '@/lib/likida/perfil/preguntas';
import { getPerfilCrudo, guardarDeclaracionEstimuloPeaje } from '@/lib/likida/repo';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { logger } from '@/lib/logger';
import { CampoSelect, FormaConAviso, Tarjeta, type ResultadoAccion } from '@/app/ui-v2/componentes';
import './contador.css';

/**
 * FASE 3 — la pregunta que cierra el hueco H6 (LIF 2026 art. 20-A).
 *
 * Sin este formulario el candado de `calificaEstimuloPeaje` nunca se gira:
 * `elegiblePeaje` queda `undefined` y el motor deja el estímulo en $0
 * (fail-closed). Vive en el panel del contador porque
 * el dato es fiscal y esa ruta es `dinero` (contador, dueño, superadmin).
 *
 * La pregunta es binaria a propósito: pedir un monto exacto invita a
 * inventar una cifra. El umbral legal es "menores a $300 millones".
 */
export async function EstimuloPeaje({
  searchParams,
  tenantExiste,
}: {
  searchParams: { vista?: string; tenant?: string; rol?: string };
  tenantExiste: boolean;
}) {
  const { t: tr } = await getT('dinero');
  if (!tenantExiste) return null;

  const { tenantId } = await resolverTenantEfectivo('/dashboard/contador', searchParams);
  // FRONTEND-19C2-5: antes un error de LECTURA (`perfil = {}`) se volvía
  // indistinguible de "nunca declaró" — el contador veía "sin esta
  // declaración el estímulo queda en $0" cuando en realidad Likida no pudo
  // ni preguntar, y si contestaba de nuevo confundido reescribía una
  // declaración real como "$0" por las puras. `leyoOk` conserva la
  // distinción, mismo patrón que `safe()` en `inicio-contador.tsx`.
  let perfil: unknown = {};
  let leyoOk = true;
  try {
    perfil = await getPerfilCrudo(tenantId);
  } catch (e) {
    leyoOk = false;
    perfil = {};
    logger.warn('estimulo_peaje.perfil_no_leido', { tenantId, err: e instanceof Error ? e.message : String(e) });
  }
  const { elegible } = calificaEstimuloPeaje(perfil);
  const pendiente = preguntaPendienteEstimuloPeaje(perfil);
  const declarado = umbralPeajeDeclarado(perfil);
  const umbralInicial = declarado.ingresosMenoresA300M === null ? '' : declarado.ingresosMenoresA300M ? 'menor' : 'mayor';
  const parteInicial = declarado.parteRelacionada === null ? '' : declarado.parteRelacionada ? 'si' : 'no';

  async function accion(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr, idioma } = await getT('dinero');
    const s = await resolverTenantAtadoAccion('/dashboard/contador', searchParams, tenantId);
    if (!s) return { error: MENSAJE_FLOTA_CAMBIO };
    if (!puedeVerRuta(s.rol, '/dashboard/contador')) {
      return { error: tr('contador.estimuloPeaje.tuRolNoPuede') };
    }
    const ingresos = String(fd.get('ingresos') ?? '');
    const parte = String(fd.get('parte') ?? '');
    if (ingresos !== 'menor' && ingresos !== 'mayor') {
      return { error: tr('contador.estimuloPeaje.faltaDecirSiLos') };
    }
    if (parte !== 'si' && parte !== 'no') {
      return { error: tr('contador.estimuloPeaje.faltaDecirSiLa') };
    }
    try {
      await guardarDeclaracionEstimuloPeaje(
        s.tenantId,
        ingresos === 'menor',
        parte === 'si',
        s.userId,
      );
    } catch (e) {
      return { error: mensajeParaPantalla(e, tr('contador.estimuloPeaje.operacionGuardar'), idioma) };
    }
    revalidatePath('/dashboard/contador');
    const califica = ingresos === 'menor' && parte === 'no';
    return {
      ok: califica
        ? tr('contador.estimuloPeaje.declaracionGuardadaEl50')
        : tr('contador.estimuloPeaje.declaracionGuardadaEstaFlota'),
    };
  }

  return (
    <Tarjeta titulo={tr('contador.estimuloPeaje.estimuloDePeajeLif')}>
      <div className="rv-cont__lista">
        <p className="rv-cont__linea">
          {!leyoOk
            ? tr('contador.estimuloPeaje.noPudeLeerSi')
            : pendiente
              ? tr('contador.estimuloPeaje.sinEstaDeclaracionEl')
              : elegible
                ? tr('contador.estimuloPeaje.declaradoIngresosMenoresA')
                : tr('contador.estimuloPeaje.declaradoEstaFlotaNo')}
        </p>
        {/* No se ofrece el formulario si no se pudo leer el estado real: dejar contestar aquí es exactamente lo que reescribiría una declaración real existente como "$0" por confusión del usuario. */}
        {leyoOk && (
          <FormaConAviso accion={accion} boton={pendiente ? 'Declarar' : tr('contador.estimuloPeaje.corregirDeclaracion')} columnas="md:grid-cols-2">
            <CampoSelect id="ingresos" name="ingresos" etiqueta={tr('contador.estimuloPeaje.ingresosTotalesAnualesDel')} obligatorio
              defaultValue={umbralInicial}
              ayuda={tr('contador.estimuloPeaje.elUmbralLegalEs')}>
              <option value="">{tr('contador.estimuloPeaje.eligeUna')}</option>
              <option value="menor">{tr('contador.estimuloPeaje.menoresA300Millones')}</option>
              <option value="mayor">{tr('contador.estimuloPeaje.300MillonesOMas')}</option>
            </CampoSelect>
            <CampoSelect id="parte" name="parte" etiqueta={tr('contador.estimuloPeaje.esParteRelacionadaDe')} obligatorio
              defaultValue={parteInicial}>
              <option value="">{tr('contador.estimuloPeaje.eligeUna')}</option>
              <option value="no">{tr('contador.estimuloPeaje.no')}</option>
              <option value="si">{tr('contador.estimuloPeaje.si')}</option>
            </CampoSelect>
          </FormaConAviso>
        )}
      </div>
    </Tarjeta>
  );
}
