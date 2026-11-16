import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { mxn, numero } from '@/lib/formato';
import { getT, idiomaActual } from '@/lib/i18n/servidor';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import { leerTablero, type Tablero } from '@/lib/backoffice/tablero';
import { etiquetaMesCorta } from '@/lib/backoffice/periodo';
import type { Lectura } from '@/lib/backoffice/lectura';
import { Aviso, BotonEnlace, FilaTarjetas, Tarjeta } from '@/app/ui-v2/componentes';
import { Columnas, DonaMini, type PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoPanelCifras } from '@/app/ui-v2/esqueletos';
import { uniformes } from '../cifras-uniformes';
import { observadas } from '../sello-observado';
import { RejillaAreas, TarjetaAutomatizacion, TarjetaMetricas } from './tarjetas-tablero';
import '../dinero.css';
import '../resumen.css';
import './tablero.css';
import { NotaVacia } from '../nota-vacia';

export const dynamic = 'force-dynamic';

type Tr = TrDe<'admin_backoffice'>;

/** Una fuente que no se pudo leer: «No disponible. No es cero.» si la tabla aún no existe, «no se pudo leer» (con Reintentar) si falló. */
function sinLeer(etiqueta: string, l: Lectura<unknown>, t: Tr): PropsCifra {
  return l.estado === 'no_disponible'
    ? { etiqueta, valor: null, estado: 'vacio', mensaje: t('bo.no_disponible') }
    : { etiqueta, valor: null, estado: 'error', mensaje: t('portada.no_se_pudo_leer'), reintentar: true };
}

/** La tira de seis cifras del mes en curso. Cada una cae por su lado: una fuente caída no apaga a las demás ni se pinta como cero. */
function cifrasDelTablero(tab: Tablero, t: Tr, tp: (clave: 'portada.c_cobrado_nota', n: number) => string): PropsCifra[] {
  const f = tab.facturacion;
  const eCobrado = t('portada.c_cobrado');
  const ePorCobrar = t('portada.c_por_cobrar');
  const eGasto = t('portada.c_gasto');
  const eComis = t('portada.c_comisiones');
  const eContratos = t('portada.c_contratos');
  const eObl = t('portada.c_obligaciones');

  const cobrado: PropsCifra = f.estado !== 'ok'
    ? sinLeer(eCobrado, f, t)
    : {
      etiqueta: eCobrado, valor: f.dato.cobradoMesCent / 100, formato: 'mxn', nota: tp('portada.c_cobrado_nota', f.dato.nCobradasMes),
      serie: f.dato.serieCobrado === null ? undefined : f.dato.serieCobrado.map((s) => s.cent / 100),
    };

  const porCobrar: PropsCifra = f.estado !== 'ok'
    ? sinLeer(ePorCobrar, f, t)
    : f.dato.porCobrarCent === null
      ? { etiqueta: ePorCobrar, valor: null, estado: 'error', mensaje: t('portada.lista_recortada'), reintentar: true }
      : {
        etiqueta: ePorCobrar, valor: f.dato.porCobrarCent / 100, formato: 'mxn',
        nota: f.dato.nPorCobrar === 0 || f.dato.masViejaDias === null ? t('portada.c_por_cobrar_nada') : t('portada.c_por_cobrar_nota', { n: numero(f.dato.nPorCobrar ?? 0), dias: numero(f.dato.masViejaDias) }),
        tono: (f.dato.nPorCobrar ?? 0) > 0 ? 'warn' : undefined,
      };

  const g = tab.gastos;
  const gasto: PropsCifra = g.estado !== 'ok'
    ? sinLeer(eGasto, g, t)
    : {
      etiqueta: eGasto, valor: g.dato.totalCent / 100, formato: 'mxn',
      nota: g.dato.n === 0 ? t('portada.c_gasto_ninguno') : t('portada.n_de_m_conciliados', { n: numero(g.dato.conciliados), m: numero(g.dato.n) }),
    };

  const c = tab.comisiones;
  const comis: PropsCifra = c.estado !== 'ok'
    ? sinLeer(eComis, c, t)
    : { etiqueta: eComis, valor: c.dato.devengadoCent / 100, formato: 'mxn', nota: t('portada.c_comisiones_nota', { claw: mxn(Math.abs(c.dato.clawbackCent) / 100) }) };

  const k = tab.contratos;
  const contratos: PropsCifra = k.estado !== 'ok'
    ? sinLeer(eContratos, k, t)
    : {
      etiqueta: eContratos, valor: k.dato.vencenEn30, formato: 'entero',
      nota: k.dato.total === 0 ? t('portada.c_contratos_ninguno') : t('portada.c_contratos_nota', { vencidos: numero(k.dato.vencidos), sinFecha: numero(k.dato.sinFecha) }),
      tono: k.dato.vencidos > 0 ? 'bad' : k.dato.vencenEn30 > 0 ? 'warn' : undefined,
    };

  const o = tab.obligaciones;
  const obligaciones: PropsCifra = o.estado !== 'ok'
    ? sinLeer(eObl, o, t)
    : {
      etiqueta: eObl, valor: o.dato.catalogadas, formato: 'entero',
      nota: tab.candado === 'sin_rfc' ? t('portada.c_obl_sin_rfc') : tab.candado === 'desconocido' ? t('portada.c_obl_entidad_ilegible') : t('portada.c_obl_nota', { n: numero(o.dato.pendientesDeContador) }),
    };

  return [cobrado, porCobrar, gasto, comis, contratos, obligaciones];
}

export default async function BackOfficePage() {
  const { t, tp } = await getT('admin_backoffice');
  // La puerta de la PÁGINA, no solo la del layout: lo que se lee aquí cruza todas las flotas con service role.
  await requireSuperadmin();
  const idioma = (await idiomaActual()) === 'en' ? 'en' : 'es';
  const tab = await leerTablero();

  const cifras = observadas(uniformes(cifrasDelTablero(tab, t, (clave, n) => tp(clave, n))), t('comun.observado'));

  // Avisos: UNO solo, fijo, el candado de la entidad. Mientras no haya RFC propio, nada fiscal se evalúa ni se rellena.
  const aviso = tab.candado === 'sin_rfc'
    ? (
      <Aviso tono="info" titulo={t('comun.candado_titulo')} acciones={<BotonEnlace tamano="sm" variante="secondary" href="/admin/back-office/entidad">{t('comun.candado_cta')}</BotonEnlace>}>
        {t('comun.candado_texto')}
      </Aviso>
    )
    : tab.candado === 'desconocido'
      ? <Aviso tono="warn" titulo={t('comun.entidad_ilegible_titulo')}>{t('comun.entidad_ilegible_texto')}</Aviso>
      : null;

  // Gráficas: cobrado por mes (8) y mensualidades del mes por estado (4). Sin dato = el motivo, no una gráfica en cero.
  const f = tab.facturacion;
  const barras = f.estado !== 'ok'
    ? <Tarjeta key="barras" titulo={t('portada.g_cobrado_mes')} estado={f.estado === 'error' ? 'error' : 'vacio'} mensaje={f.estado === 'error' ? t('portada.no_se_pudo_leer') : t('bo.no_disponible')} reintentar />
    : f.dato.serieCobrado === null
      ? <Tarjeta key="barras" titulo={t('portada.g_cobrado_mes')} contenida><NotaVacia titulo={t('portada.lista_recortada')} /></Tarjeta>
      : (
        <Tarjeta key="barras" titulo={t('portada.g_cobrado_mes')} elevar entra="tarjeta">
          <Columnas
            datos={f.dato.serieCobrado.map((s) => ({ etiqueta: etiquetaMesCorta(s.periodo, idioma), valor: s.cent / 100 }))}
            etiqueta={t('portada.g_cobrado_mes')} formato="mxn" matiz={3}
          />
          <ul className="aud16b-leyenda"><li><i data-m="3" aria-hidden="true" />{t('portada.g_cobrado_mes')}</li></ul>
        </Tarjeta>
      );

  const e = f.estado === 'ok' ? f.dato.estadosMes : null;
  const totalMes = e === null ? 0 : e.cobradas + e.pagadasSinEvidencia + e.pendientes + e.fallidas;
  const dona = f.estado !== 'ok'
    ? <Tarjeta key="dona" titulo={t('portada.g_estado_mes')} estado={f.estado === 'error' ? 'error' : 'vacio'} mensaje={f.estado === 'error' ? t('portada.no_se_pudo_leer') : t('bo.no_disponible')} reintentar />
    : e === null || totalMes === 0
      ? <Tarjeta key="dona" titulo={t('portada.g_estado_mes')} contenida><NotaVacia titulo={t('portada.g_estado_mes_vacio')}>{t('portada.g_estado_mes_vacio_detalle')}</NotaVacia></Tarjeta>
      : (
        <Tarjeta key="dona" titulo={t('portada.g_estado_mes')} elevar entra="tarjeta">
          <DonaMini
            etiqueta={t('portada.g_estado_mes')} matiz={8} formato="numero" centro={numero(totalMes)}
            gajos={[
              { etiqueta: t('portada.e_cobradas'), valor: e.cobradas },
              { etiqueta: t('portada.e_sin_evidencia'), valor: e.pagadasSinEvidencia },
              { etiqueta: t('portada.e_pendientes'), valor: e.pendientes },
              { etiqueta: t('portada.e_fallidas'), valor: e.fallidas },
            ]}
          />
        </Tarjeta>
      );

  return (
    <EsqueletoPanelCifras
      titulo={t('pul9.h_tablero')} apoyo={t('portada.apoyo')}
      acciones={<BotonEnlace tamano="sm" variante="secondary" href="/admin/back-office/entidad">{t('pul9.entidad_enlace')}</BotonEnlace>}
      etiquetaCifras={t('portada.cifras_mes')} cifras={cifras}
      avisos={aviso} graficas={[barras, dona]} variante="8-4"
    >
      <div className="adm-pila">
        <RejillaAreas tab={tab} t={t} idioma={idioma} />
        <FilaTarjetas variante="6-6" className="adm-fila-pareja">
          <TarjetaMetricas tab={tab} t={t} idioma={idioma} />
          <TarjetaAutomatizacion t={t} idioma={idioma} />
        </FilaTarjetas>
      </div>
    </EsqueletoPanelCifras>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_backoffice');
  return { title: `${t('pul9.h_tablero')} · ${t('bo.nombre')}` };
}
