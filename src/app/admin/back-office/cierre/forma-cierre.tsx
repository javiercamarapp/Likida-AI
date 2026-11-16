import { Boton, CampoTexto, FormaConAviso } from '@/app/ui-v2/componentes';
import type { EstadoCierre } from '@/lib/backoffice/cierre';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { accionCerrarMes, accionGenerarBorrador, accionGuardarTipoCambio, accionMarcarListo, accionReabrirMes } from './acciones';

type Tr = TrDe<'admin_backoffice'>;

/**
 * Los controles del cierre de UN mes. Lo que se puede hacer depende del estado: `abierto` (o sin borrador) genera borrador, pasa a «listo» y
 * guarda el tipo de cambio; `listo` se cierra (con su confirmación); `cerrado` solo se reabre, con motivo obligatorio. Un botón que hoy no
 * se puede apretar se muestra APAGADO con su razón al lado: nunca desaparece sin explicación.
 */
export function FormasCierre({ t, periodo, estado, tablaDisponible, mesTerminado, puedeListo, tipoCambio }: {
  t: Tr;
  periodo: string;
  /** `null` = aún sin borrador guardado. */
  estado: EstadoCierre | null;
  /** La tabla `bo_cierre_mes` existe en esa base. */
  tablaDisponible: boolean;
  /** El mes ya terminó (solo un mes terminado se marca listo o cerrado). */
  mesTerminado: boolean;
  /** Todas las comprobaciones bloqueantes están en verde. */
  puedeListo: boolean;
  tipoCambio: number | null;
}) {
  if (!tablaDisponible) return <p className="adm-din-nota">{t('cierre.sin_tabla')}</p>;

  const oculto = <input type="hidden" name="periodo" value={periodo} />;
  const cerrado = estado === 'cerrado';

  return (
    <div className="bo-acciones adm-forma-fina">
      {cerrado ? (
        <FormaConAviso
          accion={accionReabrirMes} boton={t('cierre.btn_reabrir')} columnas="md:grid-cols-1"
          confirmar={{ titulo: t('cierre.reabrir_titulo'), descripcion: t('cierre.reabrir_descripcion'), etiquetaConfirmar: t('cierre.btn_reabrir') }}
        >
          {oculto}
          <CampoTexto etiqueta={t('cierre.motivo')} name="motivo" obligatorio minLength={5} maxLength={300} ayuda={t('cierre.motivo_ayuda')} />
        </FormaConAviso>
      ) : (
        <>
          <div className="bo-fila-acciones">
            <FormaConAviso accion={accionGenerarBorrador} boton={estado === null ? t('cierre.btn_borrador') : t('cierre.btn_regenerar')} columnas="md:grid-cols-1">
              {oculto}
            </FormaConAviso>
            {estado === 'listo' ? (
              <FormaConAviso
                accion={accionCerrarMes} boton={t('cierre.btn_cerrar')} columnas="md:grid-cols-1"
                confirmar={{ titulo: t('cierre.cerrar_titulo'), descripcion: t('cierre.cerrar_descripcion'), etiquetaConfirmar: t('cierre.btn_cerrar') }}
              >
                {oculto}
              </FormaConAviso>
            ) : estado === 'abierto' && mesTerminado && puedeListo ? (
              <FormaConAviso accion={accionMarcarListo} boton={t('cierre.btn_listo')} columnas="md:grid-cols-1">
                {oculto}
              </FormaConAviso>
            ) : (
              <div>
                <Boton variante="secondary" tamano="sm" disabled>{t('cierre.btn_listo')}</Boton>
              </div>
            )}
          </div>
          {estado !== 'listo' && !(estado === 'abierto' && mesTerminado && puedeListo) ? (
            <p className="adm-din-nota">
              {estado === null ? t('cierre.listo_requiere_borrador') : !mesTerminado ? t('cierre.listo_mes_en_curso') : t('cierre.listo_bloqueado')}
            </p>
          ) : null}
          <FormaConAviso accion={accionGuardarTipoCambio} boton={t('cierre.btn_tipo_cambio')} columnas="md:grid-cols-1">
            {oculto}
            <CampoTexto
              etiqueta={t('cierre.tipo_cambio')} name="tipoCambio" tipo="number" step="0.0001" min="0.0001" obligatorio
              defaultValue={tipoCambio === null ? '' : String(tipoCambio)} ayuda={t('cierre.tipo_cambio_ayuda')}
            />
          </FormaConAviso>
        </>
      )}
    </div>
  );
}
