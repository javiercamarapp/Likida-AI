import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSuperadmin } from '@/lib/auth/guard';
import { fechaMx, hoyMx, mxn } from '@/lib/formato';
import { getT } from '@/lib/i18n/servidor';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { Aviso, CampoSelect, CampoTextarea, Disclosure, FormaConAviso, StatusChip, TablaBase, Tarjeta, type TonoEstado } from '@/app/ui-v2/componentes';
import { BarList, Columnas, type PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { uniformes } from '../../cifras-uniformes';
import { observadas } from '../../sello-observado';
import { listarContratos, leerRfcEntidad, type Contrato } from '@/lib/backoffice/contratos';
import { evaluarVencimiento, ordenarPorUrgencia, resumenVencimientos, TIPOS_CONTRATO, vencimientosPorMes, type Vencimiento } from '@/lib/backoffice/vencimientos';
import { accionGuardarContrato, accionTerminarContrato } from './acciones';
import { FormaContrato } from './forma-contrato';
import '../../dinero.css';
import '../../resumen.css';
import './contratos.css';

export const dynamic = 'force-dynamic';

type Fila = { c: Contrato; ev: Vencimiento };
type T = TrDe<'admin_backoffice'>;

const TONO: Record<Vencimiento['nivel'], TonoEstado> = { vencido: 'bad', urgente: 'bad', proximo: 'warn', fuera: 'ok', sin_fecha: 'warn', no_vence: 'muted', inactivo: 'muted' };

/** El rótulo de la pastilla, ya en el idioma de la pantalla. Un vencimiento sin fecha NUNCA se rotula «vigente». */
function rotulo(f: Fila, t: T): string {
  const { ev, c } = f;
  if (c.estado === 'terminado') return t('contratos.estado_terminado');
  if (c.estado === 'borrador') return t('contratos.estado_borrador');
  if (ev.nivel === 'no_vence') return t('venc.no_vence');
  if (ev.dias === null) return t('venc.sin_fecha');
  if (ev.dias < 0) return ev.dias === -1 ? t('venc.vencido_ayer') : t('venc.vencido_hace', { n: Math.abs(ev.dias) });
  if (ev.dias === 0) return t('venc.vence_hoy');
  if (ev.dias === 1) return t('venc.vence_manana');
  return ev.dentroDeVentana ? t('venc.vence_en', { n: ev.dias }) : t('venc.vigente_n', { n: ev.dias });
}

export default async function ContratosPage({ searchParams }: { searchParams: Promise<{ editar?: string }> }) {
  const { t, idioma } = await getT('admin_backoffice');
  // Puerta PROPIA en el render (el layout no se re-ejecuta en una petición RSC parcial).
  await requireSuperadmin();
  const sp = (await searchParams) ?? {};
  const hoy = hoyMx();
  const [lista, rfc] = await Promise.all([listarContratos(), leerRfcEntidad()]);

  const filas: Fila[] | null = lista.estado === 'ok'
    ? lista.dato.map((c) => ({ c, ev: evaluarVencimiento({ tipo: c.tipo, estado: c.estado, venceEl: c.venceEl, diasAviso: c.diasAviso, responsable: c.responsable }, hoy) }))
    : null;
  const vivas = filas ? ordenarPorUrgencia(filas.filter((f) => f.ev.estado !== 'inactivo'), (f) => f.ev.dias) : [];
  const inactivas = filas ? filas.filter((f) => f.ev.estado === 'inactivo') : [];
  const ordenadas = [...vivas, ...inactivas];
  const r = resumenVencimientos(vivas.map((f) => ({ tipo: f.c.tipo, ev: f.ev })));
  const aAtender = vivas.filter((f) => f.ev.dentroDeVentana || f.ev.estado === 'vencido').slice(0, 8);
  const editando = filas && sp.editar ? filas.find((f) => f.c.id === sp.editar && f.c.estado !== 'terminado')?.c ?? null : null;

  // ── Cifras: lo leído de la base, o «No disponible. No es cero.» / «no se pudo leer». Nunca un 0 inventado. ──
  const cifra = (etiqueta: string, valor: number, extra: Partial<PropsCifra> = {}): PropsCifra => {
    if (lista.estado === 'no_disponible') return { etiqueta, valor: null, estado: 'vacio', mensaje: t('bo.no_disponible') };
    if (lista.estado === 'error') return { etiqueta, valor: null, estado: 'error', mensaje: t('contratos.no_se_pudo_leer'), reintentar: true };
    return { etiqueta, valor, formato: 'entero', ...extra };
  };
  const nVigentes = vivas.filter((f) => f.ev.estado === 'vigente').length;
  const cifras: PropsCifra[] = uniformes([
    cifra(t('contratos.c_vivos'), r.vivos, {
      nota: r.clientesVivos === 0 ? t('contratos.cero_clientes') : t('contratos.c_vivos_nota', { n: r.clientesVivos }),
      segmentos: [
        { etiqueta: t('contratos.seg_vencidos'), valor: r.vencidos },
        { etiqueta: t('contratos.seg_por_vencer'), valor: r.vencenEnVentana },
        { etiqueta: t('contratos.seg_vigentes'), valor: nVigentes },
        { etiqueta: t('contratos.seg_sin_fecha'), valor: r.sinFecha },
      ],
    }),
    cifra(t('contratos.c_ventana'), r.vencenEnVentana, { nota: t('contratos.c_ventana_nota'), tono: r.vencenEnVentana > 0 ? 'warn' : undefined }),
    cifra(t('contratos.c_vencidos'), r.vencidos, { nota: t('contratos.c_vencidos_nota'), tono: r.vencidos > 0 ? 'bad' : undefined }),
    cifra(t('contratos.c_sin_fecha'), r.sinFecha, { nota: t('contratos.c_sin_fecha_nota'), tono: r.sinFecha > 0 ? 'warn' : undefined }),
    cifra(t('contratos.c_sin_responsable'), r.sinResponsable, { nota: t('contratos.c_sin_responsable_nota'), tono: r.sinResponsable > 0 ? 'warn' : undefined }),
  ]);

  // ── Gráficas: vencimientos por mes (12) y vivos por tipo. Sin contratos vivos, UN vacío de una línea. ──
  const meses = vencimientosPorMes(vivas.map((f) => ({ venceEl: f.c.venceEl, ev: f.ev })), hoy, 12);
  const porTipo = TIPOS_CONTRATO.map((k) => ({ k, n: vivas.filter((f) => f.c.tipo === k).length })).filter((x) => x.n > 0);
  const graficas = lista.estado !== 'ok' || r.vivos === 0 ? [
    <Tarjeta
      key="vacio" titulo={t('contratos.g_meses')} contenida
      estado={lista.estado === 'error' ? 'error' : 'vacio'}
      mensaje={lista.estado === 'ok' ? t('contratos.sin_contratos') : lista.estado === 'error' ? t('contratos.no_se_pudo_leer') : t('bo.no_disponible')}
      detalle={lista.estado === 'ok' ? t('contratos.sin_contratos_detalle') : undefined} reintentar={lista.estado === 'error'}
    />,
  ] : [
    <Tarjeta key="meses" titulo={t('contratos.g_meses')} elevar entra="tarjeta">
      <Columnas datos={meses.map((m) => ({ etiqueta: m.mes, valor: m.n }))} etiqueta={t('contratos.g_meses')} formato="numero" matiz={5} vacio={t('contratos.g_meses_vacio')} />
    </Tarjeta>,
    <Tarjeta key="tipo" titulo={t('contratos.g_tipo')} elevar entra="tarjeta">
      <BarList etiqueta={t('contratos.g_tipo')} matiz={5} items={porTipo.map((x) => ({ clave: x.k, etiqueta: t(`contratos.tipo_${x.k}` as const), valor: x.n }))} />
    </Tarjeta>,
  ];

  const sinRfc = rfc.estado !== 'ok' || !rfc.dato || rfc.dato.trim() === '';

  return (
    <EsqueletoPanelCifras
      titulo={t('contratos.titulo')} apoyo={t('contratos.apoyo')} etiquetaCifras={t('contratos.titulo')} cifras={observadas(cifras, t('venc.observado'))}
      graficas={graficas} variante="8-4"
      avisos={sinRfc ? <Aviso tono="info" titulo={t('contratos.candado_titulo')}>{t('contratos.candado_texto')}</Aviso> : null}
    >
      <div className="adm-pila adm-forma-fina">
          <Tarjeta
            titulo={t('venc.por_atender')} estado={lista.estado === 'ok' ? 'ok' : lista.estado === 'error' ? 'error' : 'vacio'} contenida={lista.estado === 'ok' && aAtender.length === 0}
            mensaje={lista.estado === 'ok' ? t('venc.nada_en_ventana') : lista.estado === 'error' ? t('contratos.no_se_pudo_leer') : t('bo.no_disponible')}
            detalle={lista.estado === 'ok' ? t('venc.nada_en_ventana_detalle') : undefined} reintentar={lista.estado === 'error'}
          >
            {lista.estado === 'ok' && aAtender.length > 0 ? (
              <ul className="bo-ctr-avisos">
                {aAtender.map((f) => (
                  <li key={f.c.id}>
                    <span className="bo-ctr-avisos__nombre">{f.c.contraparte}</span>
                    <StatusChip tono={TONO[f.ev.nivel]}>{rotulo(f, t)}</StatusChip>
                    <span className="bo-ctr-avisos__cuando">{t('venc.vence_el', { fecha: fechaMx(f.c.venceEl, idioma) })}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Tarjeta>

          {lista.estado === 'ok' ? (
            <Disclosure titulo={editando ? t('contratos.editar_titulo', { nombre: editando.contraparte }) : t('contratos.alta_titulo')} variante="linea" abierto={editando !== null || (filas?.length ?? 0) === 0}>
              {editando ? <p><Link href="/admin/back-office/contratos">{t('contratos.cancelar_edicion')}</Link></p> : null}
              <FormaContrato key={editando?.id ?? 'nuevo'} accion={accionGuardarContrato} t={t} contrato={editando} />
            </Disclosure>
          ) : null}

        <Tarjeta
          titulo={t('contratos.lista')} estado={lista.estado === 'ok' ? 'ok' : lista.estado === 'error' ? 'error' : 'vacio'}
          mensaje={lista.estado === 'error' ? t('contratos.no_se_pudo_leer') : t('bo.no_disponible')} reintentar={lista.estado === 'error'}
        >
          {lista.estado === 'ok' ? (
            <TablaBase
              etiqueta={t('contratos.lista')} idFila={(f) => f.c.id} filas={ordenadas} tarjetaMovil densa
              vacio={{ titulo: t('contratos.sin_contratos'), texto: t('contratos.sin_contratos_detalle') }}
              columnas={[
                { id: 'contraparte', titulo: t('contratos.f_contraparte'), principal: true, celda: (f) => f.c.contraparte },
                { id: 'tipo', titulo: t('contratos.f_tipo'), celda: (f) => t(`contratos.tipo_${f.c.tipo}` as const) },
                { id: 'estado', titulo: t('contratos.f_estado'), celda: (f) => <StatusChip tono={TONO[f.ev.nivel]}>{rotulo(f, t)}</StatusChip> },
                { id: 'vence', titulo: t('contratos.f_vence'), celda: (f) => (f.c.venceEl ? fechaMx(f.c.venceEl, idioma) : f.ev.noVence ? t('venc.no_vence') : <span className="bo-ctr-sin">{t('venc.sin_fecha')}</span>) },
                {
                  id: 'responsable', titulo: t('contratos.f_responsable'),
                  celda: (f) => (f.c.responsable ?? (f.ev.hallazgos.includes('sin_responsable') ? <StatusChip tono="warn">{t('venc.sin_responsable')}</StatusChip> : '—')),
                },
                { id: 'costo', titulo: t('contratos.f_costo'), alinear: 'der', celda: (f) => (f.c.costoMensualCent === null ? '—' : mxn(f.c.costoMensualCent / 100, idioma)) },
                {
                  id: 'acciones', titulo: t('contratos.acciones'), tituloOculto: true,
                  celda: (f) => (f.c.estado === 'terminado' ? null : <Link href={`/admin/back-office/contratos?editar=${f.c.id}`}>{t('contratos.editar')}</Link>),
                },
              ]}
            />
          ) : null}
        </Tarjeta>

        {lista.estado === 'ok' && vivas.length > 0 ? (
          <Disclosure titulo={t('contratos.terminar_titulo')} resumen={t('contratos.terminar_resumen')}>
            <div className="adm-din-forma">
              <FormaConAviso
                accion={accionTerminarContrato} boton={t('contratos.terminar_boton')} columnas="md:grid-cols-1"
                confirmar={{ titulo: t('contratos.terminar_confirma_titulo'), descripcion: t('contratos.terminar_confirma_texto'), etiquetaConfirmar: t('contratos.terminar_confirma_si') }}
              >
                <CampoSelect etiqueta={t('contratos.terminar_cual')} name="id" obligatorio defaultValue="">
                  <option value="">{t('contratos.elige')}</option>
                  {vivas.map((f) => <option key={f.c.id} value={f.c.id}>{f.c.contraparte} · {t(`contratos.tipo_${f.c.tipo}` as const)}</option>)}
                </CampoSelect>
                <CampoTextarea etiqueta={t('contratos.terminar_motivo')} name="motivo" obligatorio maxLength={500} ayuda={t('contratos.terminar_motivo_ayuda')} />
              </FormaConAviso>
            </div>
          </Disclosure>
        ) : null}

        <Disclosure titulo={t('contratos.pendiente_titulo')} resumen={t('contratos.pendiente_resumen')}>
          <p className="adm-din-nota">{t('contratos.pendiente_texto')}</p>
        </Disclosure>
      </div>
    </EsqueletoPanelCifras>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_backoffice');
  return { title: t('contratos.titulo') };
}
