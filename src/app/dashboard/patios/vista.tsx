import { TarjetaTabla } from '../bloque';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { cifrasUniformes } from '../formato';
import Link from 'next/link';
import { numero } from '@/lib/formato';
import {
  FormaNuevoPatio, FormaEditarPatio, FormaJefe, FormaSinPatio, type AccionForma,
} from './formas';
import {
  AvisoCompacto, EstadoError, EstadoVacio, TablaBase, Tarjeta, type ColumnaBase,
} from '@/app/ui-v2/componentes';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { CajonAlta } from '../cajon-alta';
import './patios.css';
import { TR_OPERACION_ES, type TrOperacion } from '@/lib/i18n/operacion_tr';

export interface FilaPatio {
  id: string;
  nombre: string;
  ciudad: string | null;
  operadores: number;
  unidades: number;
  jefes: number;
}

export interface FilaJefe { userId: string; etiqueta: string; terminalId: string }

/**
 * LOS PATIOS DE LA FLOTA (W2 «producto», 1-oct-2026).
 *
 * `terminal` existe desde la 0001 y hasta hoy nada la escribía: una flota con
 * tres patios no tenía dónde decirlo, el filtro «por terminal» de Liquidación
 * quedaba vacío y `terminalId` de la API solo servía si alguien insertaba los
 * patios por SQL. Aquí se crean, se editan y se borran; se cuelgan de ellos los
 * jefes de tráfico (que con patio solo corrigen lo de su patio) y, de una vez,
 * los operadores y las unidades que la flota cargó sin patio.
 *
 * Quién administra: el DUEÑO. El jefe de tráfico ve los patios (para saber cuál
 * es el suyo) pero no los cambia: sería ampliarse a sí mismo el alcance.
 */
export function VistaPatios({ tr = TR_OPERACION_ES,
  patios, jefes, sinPatio, puedeAdministrar, ilegible, hrefOperadores, hrefUnidades,
  crear, editar, eliminar, asignarJefe, asignarSinPatio, patioDelJefe,
}: { tr?: TrOperacion;
  /** `null` = no se pudieron leer (se dice; no se enseña «sin patios»). */
  patios: FilaPatio[] | null;
  /** `null` = no se pudieron leer o el rol no los administra. */
  jefes: FilaJefe[] | null;
  /** Cuántos operadores y unidades activos no tienen patio, o null si no se pudo contar. */
  sinPatio: { operadores: number; unidades: number } | null;
  puedeAdministrar: boolean;
  ilegible: boolean;
  hrefOperadores: string;
  hrefUnidades: string;
  crear: AccionForma;
  editar: AccionForma;
  eliminar: AccionForma;
  asignarJefe: AccionForma;
  asignarSinPatio: AccionForma;
  /** El nombre del patio del jefe que mira esta pantalla (null = toda la flota). */
  patioDelJefe: string | null;
}) {
  const { t } = tr;
  const lista = patios ?? [];
  const opciones = lista.map((p) => ({ id: p.id, nombre: p.nombre }));
  const columnas: ColumnaBase<FilaPatio>[] = [
    {
      id: 'patio', titulo: t('patios.col.patio'), principal: true,
      celda: (p) => (
        <>
          {p.nombre}
          {p.ciudad && <span className="rv-pt__tenue">{p.ciudad}</span>}
        </>
      ),
    },
    { id: 'operadores', titulo: t('patios.col.operadores'), alinear: 'der', celda: (p) => numero(p.operadores) },
    { id: 'unidades', titulo: t('patios.col.unidades'), alinear: 'der', celda: (p) => numero(p.unidades) },
    { id: 'jefes', titulo: t('patios.col.jefes'), alinear: 'der', celda: (p) => numero(p.jefes) },
  ];
  // La edición de cada patio vive en su cajón (Rovaq: alta y edición en cajón lateral), abierto desde la fila. Solo quien administra.
  if (puedeAdministrar) {
    columnas.push({
      id: 'acciones', titulo: t('patios.col.acciones'), alinear: 'der', tituloOculto: true,
      celda: (p) => (
        <CajonAlta id={`editar-${p.id}`} titulo={t('patios.editar.titulo', { nombre: p.nombre })} disparador={t('op.editar')} variante="ghost">
          <FormaEditarPatio accionEditar={editar} accionEliminar={eliminar} patio={p} />
        </CajonAlta>
      ),
    });
  }
  // Cifras sobre los patios que SÍ se leyeron; si la lista no se pudo leer no hay tira (nunca ceros de relleno).
  const cifras: PropsCifra[] | undefined = ilegible ? undefined : [
    { etiqueta: t('patios.kpi'), valor: lista.length },
    { etiqueta: t('patios.col.operadores'), valor: lista.reduce((n, p) => n + p.operadores, 0) },
    { etiqueta: t('patios.col.unidades'), valor: lista.reduce((n, p) => n + p.unidades, 0) },
    { etiqueta: t('patios.cifra.jefes'), valor: lista.reduce((n, p) => n + p.jefes, 0) },
  ];
  return (
    <EsqueletoTablaMaestra
      titulo={t('patios.titulo')}
      apoyo={t('patios.apoyo')}
      acciones={puedeAdministrar ? (
        <CajonAlta id="crear" titulo={t('patios.crear.titulo')} disparador={t('patios.crear.titulo')} primario>
          <FormaNuevoPatio accion={crear} />
        </CajonAlta>
      ) : undefined}
      cifras={cifrasUniformes(cifras)}
      selloCifras={selloHoy(t('patios.tarjeta'))}
      avisos={(
        <AvisoCompacto tono="info"
          resumen={<>{t('patios.aviso')}
            {patioDelJefe && <> {t('patios.aviso.jefe.pre')} <strong>{patioDelJefe}</strong>{t('patios.aviso.jefe.post')}</>}</>}
          mas="Las plantillas de carga masiva también saben a dónde va cada camión. Un jefe con patio solo corrige operadores, unidades y jornadas de ese patio." />
      )}
    >
      <TarjetaTabla titulo={t('patios.tarjeta')} contador={ilegible ? undefined : numero(lista.length)}>
        {ilegible ? (
          <EstadoError reintentar>{t('patios.error.lista')}</EstadoError>
        ) : lista.length === 0 ? (
          <EstadoVacio titulo={t('patios.vacio.titulo')}>
            {puedeAdministrar
              ? t('patios.vacio.admin')
              : t('patios.vacio.otro')}
          </EstadoVacio>
        ) : (
          <TablaBase<FilaPatio> etiqueta={t('patios.tabla.etiqueta')} columnas={columnas} filas={lista}
            idFila={(p) => p.id} tarjetaMovil />
        )}
        <p className="rv-pt__nota">
        {t('patios.nota.pre')} <Link href={hrefOperadores} className="rv-pt__enlace">{t('patios.nota.operadores')}</Link> {t('comun.y')} <Link href={hrefUnidades} className="rv-pt__enlace">{t('patios.nota.unidades')}</Link>{t('patios.nota.post')}
      </p>
      </TarjetaTabla>

      {puedeAdministrar && lista.length > 0 && (
        <Tarjeta titulo={t('patios.jefes.titulo')} info="patios.jefes">
          <p className="rv-pt__nota">
            {t('patios.jefes.nota')}
          </p>
          {jefes === null ? (
            <EstadoError reintentar>{t('patios.jefes.error')}</EstadoError>
          ) : jefes.length === 0 ? (
            <p className="rv-pt__nota">
              {t('patios.jefes.vacio')}
            </p>
          ) : (
            <ul className="rv-pt__lista">
              {jefes.map((j) => (
                <li key={j.userId}><FormaJefe accion={asignarJefe} jefe={j} patios={opciones} /></li>
              ))}
            </ul>
          )}
        </Tarjeta>
      )}

      {puedeAdministrar && lista.length > 0 && sinPatio && (sinPatio.operadores > 0 || sinPatio.unidades > 0) && (
        <Tarjeta titulo={t('patios.sin.titulo')} info="patios.sin_patio">
          <p className="rv-pt__nota">
            {t('patios.sin.nota')}
          </p>
          <FormaSinPatio accion={asignarSinPatio} tabla="operador" cuantos={sinPatio.operadores} patios={opciones} />
          <FormaSinPatio accion={asignarSinPatio} tabla="unidad" cuantos={sinPatio.unidades} patios={opciones} />
        </Tarjeta>
      )}
    </EsqueletoTablaMaestra>
  );
}
