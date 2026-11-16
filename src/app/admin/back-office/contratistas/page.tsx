import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { fechaMx, mxn } from '@/lib/formato';
import { getT } from '@/lib/i18n/servidor';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { Aviso, CampoFecha, Disclosure, CampoSelect, CampoTexto, CampoTextarea, FormaConAviso, StatusChip, TablaBase, Tarjeta, type TonoEstado } from '@/app/ui-v2/componentes';
import { BarList, DonaMini, type PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { uniformes } from '../../cifras-uniformes';
import { observadas } from '../../sello-observado';
import { listarContratos } from '@/lib/backoffice/contratos';
import { ESQUEMAS_CONTRATISTA, estadoCfdiHonorarios, hallazgosContratista, listarContratistas, type Contratista, type EstadoCfdiHonorarios } from '@/lib/backoffice/contratistas';
import { MESES_CAJA_REQUERIDOS, puedeAbrirPuestoFijo, UMBRAL_NETO_MENSUAL_MXN } from '@/lib/backoffice/caja-minima';
import { accionCrearContratista, accionDesactivarContratista } from './acciones';
import '../../dinero.css';
import '../../resumen.css';

export const dynamic = 'force-dynamic';

type T = TrDe<'admin_backoffice'>;
const TONO_CFDI: Record<EstadoCfdiHonorarios, TonoEstado> = { vigente: 'ok', vencido: 'bad', ausente: 'warn', no_aplica: 'muted' };
const rotuloCfdi = (e: EstadoCfdiHonorarios, t: T): string => ({
  vigente: t('contratistas.cfdi_vigente'), vencido: t('contratistas.cfdi_vencido'), ausente: t('contratistas.cfdi_ausente'), no_aplica: t('contratistas.cfdi_no_aplica'),
})[e];

export default async function ContratistasPage() {
  const { t, idioma } = await getT('admin_backoffice');
  await requireSuperadmin();
  const [lista, contratos] = await Promise.all([listarContratistas(), listarContratos()]);

  const todos: Contratista[] = lista.estado === 'ok' ? lista.dato : [];
  const activos = todos.filter((c) => c.activo);
  const conHallazgo = activos.filter((c) => hallazgosContratista(c).length > 0);
  const aComision = activos.filter((c) => c.esquema === 'comision');
  const comisionSinCfdi = aComision.filter((c) => estadoCfdiHonorarios(c) !== 'vigente');

  // Candado de caja: hoy el neto mensual, la caja y el costo del puesto NO se miden en el sistema (insumos null): permitido=false con «falta».
  const caja = puedeAbrirPuestoFijo({ netoMensualMxn: null, cajaMxn: null, costoPuestoMxn: null });

  const cifra = (etiqueta: string, valor: number, extra: Partial<PropsCifra> = {}): PropsCifra => {
    if (lista.estado === 'no_disponible') return { etiqueta, valor: null, estado: 'vacio', mensaje: t('bo.no_disponible') };
    if (lista.estado === 'error') return { etiqueta, valor: null, estado: 'error', mensaje: t('contratistas.no_se_pudo_leer'), reintentar: true };
    return { etiqueta, valor, formato: 'entero', ...extra };
  };
  const cifras: PropsCifra[] = uniformes([
    cifra(t('contratistas.c_activos'), activos.length, { nota: t('contratistas.c_activos_nota') }),
    cifra(t('contratistas.c_comision'), aComision.length, { nota: t('contratistas.c_comision_nota') }),
    cifra(t('contratistas.c_cfdi'), comisionSinCfdi.length, { nota: t('contratistas.c_cfdi_nota'), tono: comisionSinCfdi.length > 0 ? 'warn' : undefined }),
    cifra(t('contratistas.c_hallazgos'), conHallazgo.length, { nota: t('contratistas.c_hallazgos_nota'), tono: conHallazgo.length > 0 ? 'warn' : undefined }),
    { etiqueta: t('contratistas.c_caja'), valor: null, estado: 'vacio', mensaje: t('bo.no_disponible'), nota: t('contratistas.c_caja_nota') },
  ]);

  const porEsquema = ESQUEMAS_CONTRATISTA.map((k) => ({ k, n: activos.filter((c) => c.esquema === k).length })).filter((x) => x.n > 0);
  const porCfdi = (['vigente', 'vencido', 'ausente'] as const).map((k) => ({ k, n: aComision.concat(activos.filter((c) => c.esquema === 'honorarios')).filter((c) => estadoCfdiHonorarios(c) === k).length })).filter((x) => x.n > 0);
  const graficas = lista.estado !== 'ok' || activos.length === 0 ? [
    <Tarjeta
      key="vacio" titulo={t('contratistas.g_esquema')} contenida estado={lista.estado === 'error' ? 'error' : 'vacio'}
      mensaje={lista.estado === 'ok' ? t('contratistas.sin_contratistas') : lista.estado === 'error' ? t('contratistas.no_se_pudo_leer') : t('bo.no_disponible')}
      detalle={lista.estado === 'ok' ? t('contratistas.sin_contratistas_detalle') : undefined} reintentar={lista.estado === 'error'}
    />,
  ] : [
    <Tarjeta key="esquema" titulo={t('contratistas.g_esquema')} elevar entra="tarjeta">
      <BarList etiqueta={t('contratistas.g_esquema')} matiz={8} items={porEsquema.map((x) => ({ clave: x.k, etiqueta: t(`contratistas.esquema_${x.k}` as const), valor: x.n }))} />
    </Tarjeta>,
    porCfdi.length === 0
      ? <Tarjeta key="cfdi" titulo={t('contratistas.g_cfdi')} estado="vacio" contenida mensaje={t('contratistas.g_cfdi_vacio')} />
      : (
        <Tarjeta key="cfdi" titulo={t('contratistas.g_cfdi')} elevar entra="tarjeta">
          <DonaMini etiqueta={t('contratistas.g_cfdi')} formato="numero" matiz={8} gajos={porCfdi.map((x) => ({ etiqueta: rotuloCfdi(x.k, t), valor: x.n }))} />
        </Tarjeta>
      ),
  ];

  return (
    <EsqueletoPanelCifras
      titulo={t('contratistas.titulo')} apoyo={t('contratistas.apoyo')} etiquetaCifras={t('contratistas.titulo')} cifras={observadas(cifras, t('venc.observado'))}
      graficas={graficas} variante="6-6"
      avisos={<Aviso tono="info" titulo={t('contratistas.nomina_titulo')}>{t('contratistas.nomina_aviso')}</Aviso>}
    >
      <div className="adm-pila adm-forma-fina">
          <Tarjeta titulo={t('contratistas.caja_titulo')} acciones={<StatusChip tono="bad">{t('contratistas.caja_no_permitido')}</StatusChip>}>
            <p className="adm-din-nota">{t('contratistas.caja_regla', { neto: mxn(UMBRAL_NETO_MENSUAL_MXN, idioma), meses: MESES_CAJA_REQUERIDOS })}</p>
            <ul className="adm-din-lista">
              {caja.falta.map((f) => <li key={f}>{t(`contratistas.falta_${f}` as const)}</li>)}
            </ul>
            <p className="adm-din-nota">{t('contratistas.caja_vendedores')}</p>
          </Tarjeta>

            {lista.estado === 'ok' ? (
              <Disclosure titulo={t('contratistas.alta_titulo')} variante="linea" abierto={todos.length === 0}>
              <FormaConAviso accion={accionCrearContratista} boton={t('contratistas.guardar')} columnas="md:grid-cols-2">
                <CampoTexto etiqueta={t('contratistas.f_nombre')} name="nombre" obligatorio maxLength={160} />
                <CampoTexto etiqueta={t('contratistas.f_rol')} name="rol" maxLength={120} />
                <CampoSelect etiqueta={t('contratistas.f_esquema')} name="esquema" obligatorio defaultValue="">
                  <option value="">{t('contratistas.elige')}</option>
                  {ESQUEMAS_CONTRATISTA.map((k) => <option key={k} value={k}>{t(`contratistas.esquema_${k}` as const)}</option>)}
                </CampoSelect>
                <CampoTexto etiqueta={t('contratistas.f_rfc')} name="rfc" maxLength={13} ayuda={t('contratistas.f_rfc_ayuda')} />
                <CampoSelect etiqueta={t('contratistas.f_cfdi')} name="cfdiVigente" defaultValue="">
                  <option value="">{t('contratistas.cfdi_sin_dato')}</option>
                  <option value="si">{t('contratistas.cfdi_vigente')}</option>
                  <option value="no">{t('contratistas.cfdi_vencido')}</option>
                </CampoSelect>
                <CampoFecha etiqueta={t('contratistas.f_constancia')} name="constanciaEn" />
                {contratos.estado === 'ok' ? (
                  <CampoSelect etiqueta={t('contratistas.f_contrato')} name="contratoId" defaultValue="">
                    <option value="">{t('contratistas.sin_contrato')}</option>
                    {contratos.dato.filter((c) => c.estado !== 'terminado').map((c) => <option key={c.id} value={c.id}>{c.contraparte}</option>)}
                  </CampoSelect>
                ) : null}
                <CampoTextarea etiqueta={t('contratistas.f_nota')} name="nota" maxLength={500} />
              </FormaConAviso>
              </Disclosure>
            ) : null}

        <Tarjeta
          titulo={t('contratistas.lista')} estado={lista.estado === 'ok' ? 'ok' : lista.estado === 'error' ? 'error' : 'vacio'}
          mensaje={lista.estado === 'error' ? t('contratistas.no_se_pudo_leer') : t('bo.no_disponible')} reintentar={lista.estado === 'error'}
        >
          {lista.estado === 'ok' ? (
            <TablaBase
              etiqueta={t('contratistas.lista')} idFila={(c) => c.id} filas={todos} tarjetaMovil densa
              vacio={{ titulo: t('contratistas.sin_contratistas'), texto: t('contratistas.sin_contratistas_detalle') }}
              columnas={[
                { id: 'nombre', titulo: t('contratistas.f_nombre'), principal: true, celda: (c) => <>{c.nombre}{c.rol ? <span className="adm-din-sub">{c.rol}</span> : null}</> },
                { id: 'esquema', titulo: t('contratistas.f_esquema'), celda: (c) => t(`contratistas.esquema_${c.esquema}` as const) },
                { id: 'cfdi', titulo: t('contratistas.f_cfdi'), celda: (c) => { const e = estadoCfdiHonorarios(c); return c.activo ? <StatusChip tono={TONO_CFDI[e]}>{rotuloCfdi(e, t)}</StatusChip> : '—'; } },
                { id: 'rfc', titulo: t('contratistas.f_rfc'), celda: (c) => c.rfc ?? '—' },
                { id: 'constancia', titulo: t('contratistas.f_constancia'), celda: (c) => (c.constanciaSituacionFiscalEn ? fechaMx(c.constanciaSituacionFiscalEn, idioma) : '—') },
                { id: 'estado', titulo: t('contratistas.f_estado'), celda: (c) => <StatusChip tono={c.activo ? 'ok' : 'muted'}>{c.activo ? t('contratistas.activo') : t('contratistas.inactivo')}</StatusChip> },
                {
                  id: 'acciones', titulo: t('contratistas.acciones'), tituloOculto: true,
                  celda: (c) => (c.activo ? (
                    <FormaConAviso accion={accionDesactivarContratista} boton={t('contratistas.desactivar')} enLinea>
                      <input type="hidden" name="id" value={c.id} />
                    </FormaConAviso>
                  ) : null),
                },
              ]}
            />
          ) : null}
        </Tarjeta>
      </div>
    </EsqueletoPanelCifras>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_backoffice');
  return { title: t('contratistas.titulo') };
}
