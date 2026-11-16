import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { fechaHoraMx } from '@/lib/formato';
import { getT, idiomaActual } from '@/lib/i18n/servidor';
import { candadoDeEntidad, leerEntidad } from '@/lib/backoffice/entidad';
import { Aviso, CampoFecha, CampoTexto, FilaTarjetas, FormaConAviso, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { accionGuardarEntidad } from './acciones';
import '../../dinero.css';
import '../../resumen.css';
import '../tablero.css';

export const dynamic = 'force-dynamic';

export default async function EntidadPage() {
  const { t } = await getT('admin_backoffice');
  // La puerta de la PÁGINA, no solo la del layout.
  await requireSuperadmin();
  const idioma = (await idiomaActual()) === 'en' ? 'en' : 'es';
  const lectura = await leerEntidad();
  const candado = candadoDeEntidad(lectura);
  const e = lectura.estado === 'ok' ? lectura.dato : null;

  const estado = lectura.estado === 'no_disponible'
    ? { texto: t('bo.no_disponible'), tono: 'neutral' as const }
    : lectura.estado === 'error'
      ? { texto: t('portada.no_se_pudo_leer'), tono: 'bad' as const }
      : candado === 'con_rfc'
        ? { texto: t('comun.ent_con_rfc'), tono: 'ok' as const }
        : { texto: t('comun.ent_sin_rfc'), tono: 'warn' as const };

  const aviso = candado === 'sin_rfc'
    ? <Aviso tono="info" titulo={t('comun.candado_titulo')}>{t('comun.candado_texto')}</Aviso>
    : candado === 'desconocido'
      ? <Aviso tono="warn" titulo={t('comun.entidad_ilegible_titulo')}>{t('comun.entidad_ilegible_texto')}</Aviso>
      : null;

  const formulario = lectura.estado === 'no_disponible'
    ? <p className="adm-din-nota">{t('pul9.ent_sin_tabla')}</p>
    : lectura.estado === 'error'
      ? <Aviso tono="error" titulo={t('portada.no_se_pudo_leer')}>{t('comun.ent_err_leer')}</Aviso>
      : (
        <div className="adm-forma-fina">
          <FormaConAviso accion={accionGuardarEntidad} boton={t('comun.ent_guardar')} columnas="md:grid-cols-2">
            <CampoTexto etiqueta={t('comun.ent_razon_social')} name="razonSocial" defaultValue={e?.razonSocial ?? ''} maxLength={200} autoComplete="off" />
            <CampoTexto etiqueta={t('comun.ent_rfc')} name="rfc" defaultValue={e?.rfc ?? ''} maxLength={13} autoComplete="off" ayuda={t('comun.ent_rfc_ayuda')} />
            <CampoTexto etiqueta={t('comun.ent_regimen')} name="regimenFiscal" defaultValue={e?.regimenFiscal ?? ''} maxLength={80} autoComplete="off" ayuda={t('comun.ent_regimen_ayuda')} />
            <CampoTexto etiqueta={t('comun.ent_cp')} name="domicilioFiscalCp" defaultValue={e?.domicilioFiscalCp ?? ''} maxLength={5} inputMode="numeric" autoComplete="off" />
            <CampoFecha etiqueta={t('comun.ent_constituida')} name="constituidaEl" defaultValue={e?.constituidaEl ?? ''} />
          </FormaConAviso>
          {lectura.estado === 'ok' && lectura.dato?.actualizadaEn
            ? <p className="adm-din-nota">{t('comun.ent_actualizada', { cuando: fechaHoraMx(lectura.dato.actualizadaEn, idioma) })}</p>
            : null}
        </div>
      );

  // Qué se destraba con el RFC propio: con RFC, esas piezas dejan de decir «no evaluable»; sin él, se dice y no se rellena nada.
  const bloqueadas = ['comun.ent_d_contabilidad', 'comun.ent_d_diot', 'comun.ent_d_cfdi', 'comun.ent_d_deducible'] as const;
  const destraba = (
    <ul className="adm-din-lista">
      {bloqueadas.map((clave) => (
        <li key={clave}>
          <strong>{t(clave)}</strong>
          <StatusChip tono={candado === 'con_rfc' ? 'ok' : candado === 'sin_rfc' ? 'warn' : 'muted'}>
            {candado === 'con_rfc' ? t('comun.ent_d_evaluable') : candado === 'sin_rfc' ? t('portada.v_no_evaluable') : t('bo.no_disponible')}
          </StatusChip>
        </li>
      ))}
    </ul>
  );

  const chipEstado = <StatusChip tono={estado.tono}>{estado.texto}</StatusChip>;
  return (
    <EsqueletoPanelCifras titulo={t('pul9.h_entidad')} apoyo={t('comun.ent_apoyo')} avisos={aviso}>
      <FilaTarjetas variante="8-4" className="adm-fila-pareja">
        <Tarjeta titulo={t('comun.ent_datos')} acciones={chipEstado} elevar entra="tarjeta">
          <p className="adm-din-nota">{t('comun.ent_datos_desc')}</p>
          {formulario}
        </Tarjeta>
        <Tarjeta titulo={t('comun.ent_destraba')} elevar entra="tarjeta">
          <p className="adm-din-nota">{t('comun.ent_destraba_desc')}</p>
          {destraba}
        </Tarjeta>
      </FilaTarjetas>
    </EsqueletoPanelCifras>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_backoffice');
  return { title: t('comun.ent_metadata') };
}
