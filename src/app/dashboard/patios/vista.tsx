import Link from 'next/link';
import { numero } from '@/lib/formato';
import {
  FormaNuevoPatio, FormaEditarPatio, FormaJefe, FormaSinPatio, type AccionForma,
} from './formas';
import {
  AvisoCompacto, Disclosure, EstadoError, EstadoVacio, MarcoPagina, TablaBase, Tarjeta, type ColumnaBase,
} from '@/app/ui-v2/componentes';
import './patios.css';

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
export function VistaPatios({
  patios, jefes, sinPatio, puedeAdministrar, ilegible, hrefOperadores, hrefUnidades,
  crear, editar, eliminar, asignarJefe, asignarSinPatio, patioDelJefe,
}: {
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
  const lista = patios ?? [];
  const opciones = lista.map((p) => ({ id: p.id, nombre: p.nombre }));
  const columnas: ColumnaBase<FilaPatio>[] = [
    {
      id: 'patio', titulo: 'Patio', principal: true,
      celda: (p) => (
        <>
          {p.nombre}
          {p.ciudad && <span className="rv-pt__tenue">{p.ciudad}</span>}
        </>
      ),
    },
    { id: 'operadores', titulo: 'Operadores', alinear: 'der', celda: (p) => numero(p.operadores) },
    { id: 'unidades', titulo: 'Unidades', alinear: 'der', celda: (p) => numero(p.unidades) },
    { id: 'jefes', titulo: 'Jefes', alinear: 'der', celda: (p) => numero(p.jefes) },
  ];
  return (
    <MarcoPagina titulo="Equipo" apoyo="Un patio (o terminal) es el lugar de donde salen tus unidades.">
      <AvisoCompacto tono="info"
        resumen={<>Con patios, cada jefe de tráfico ve y corrige lo suyo y la cola de liquidación se filtra por patio.
          {patioDelJefe && <> Eres jefe de <strong>{patioDelJefe}</strong>: solo corriges lo de ese patio.</>}</>}
        mas="Las plantillas de carga masiva también saben a dónde va cada camión. Un jefe con patio solo corrige operadores, unidades y jornadas de ese patio." />

      <Tarjeta titulo="Tus patios" info="patios.lista">
        {ilegible ? (
          <EstadoError reintentar>No pude leer los patios de tu flota. No se enseña una lista a medias: parecería que faltan patios que sí existen.</EstadoError>
        ) : lista.length === 0 ? (
          <EstadoVacio titulo="Sin patios todavía">
            {puedeAdministrar
              ? 'Crea el primero abajo para repartir camiones y jefes de tráfico. Si operas desde un solo lugar, puedes dejarlo así.'
              : 'Quien administra la cuenta los crea.'}
          </EstadoVacio>
        ) : (
          <TablaBase<FilaPatio> etiqueta="Patios de la flota con sus operadores, unidades y jefes de tráfico" columnas={columnas} filas={lista}
            idFila={(p) => p.id} tarjetaMovil />
        )}
        {puedeAdministrar && lista.length > 0 && (
          <div className="rv-pt__bloque">
            {lista.map((p) => (
              <Disclosure key={p.id} variante="linea" titulo={`Editar o borrar «${p.nombre}»`}>
                <FormaEditarPatio accionEditar={editar} accionEliminar={eliminar} patio={p} />
              </Disclosure>
            ))}
          </div>
        )}
        <p className="rv-pt__nota">
          Los números cuentan solo operadores y unidades ACTIVOS. Gente y camiones se asignan a un patio desde su
          ficha en <Link href={hrefOperadores} className="rv-pt__enlace">Operadores</Link> y <Link href={hrefUnidades} className="rv-pt__enlace">Unidades</Link>,
          o con la columna «patio» de la carga masiva.
        </p>
      </Tarjeta>

      {puedeAdministrar && (
        <Disclosure variante="tarjeta" titulo="Crear un patio" abierto={!ilegible && lista.length === 0}>
          <FormaNuevoPatio accion={crear} />
        </Disclosure>
      )}

      {puedeAdministrar && lista.length > 0 && (
        <Tarjeta titulo="Jefes de tráfico" info="patios.jefes">
          <p className="rv-pt__nota">
            Con un patio asignado, el jefe solo corrige operadores, unidades y jornadas de ese patio. Sin patio ve y
            corrige toda la flota (un jefe de oficina central). Se invita al equipo desde Usuarios.
          </p>
          {jefes === null ? (
            <EstadoError reintentar>No pude leer a tus jefes de tráfico. Vuelve a intentar.</EstadoError>
          ) : jefes.length === 0 ? (
            <p className="rv-pt__nota">
              Todavía no tienes usuarios con el rol «Encargado (jefe de tráfico)». Invítalos desde Usuarios del equipo y aquí les asignas su patio.
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
        <Tarjeta titulo="Lo que cargaste sin patio" info="patios.sin_patio">
          <p className="rv-pt__nota">
            Si tu flota opera desde un solo patio, asígnalos de una vez. Si tienes varios, usa la columna «patio» de la
            carga masiva o asigna uno por uno desde su ficha.
          </p>
          <FormaSinPatio accion={asignarSinPatio} tabla="operador" cuantos={sinPatio.operadores} patios={opciones} />
          <FormaSinPatio accion={asignarSinPatio} tabla="unidad" cuantos={sinPatio.unidades} patios={opciones} />
        </Tarjeta>
      )}
    </MarcoPagina>
  );
}
