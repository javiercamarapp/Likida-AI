import Link from 'next/link';
import { MapPin, Users, Container, UserCog } from 'lucide-react';
import { numero } from '@/lib/formato';
import { EstadoVacio, EstadoError } from '@/app/admin/ui/kit';
import { BarraPagina } from '../resumen-visual';
import { Plegable } from '../clientes/forma';
import {
  FormaNuevoPatio, FormaEditarPatio, FormaJefe, FormaSinPatio, type AccionForma,
} from './formas';

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
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<MapPin width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Patios"
        />
        <div className="px-5 py-5 flex-1 space-y-4">
          <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
            Un patio (o terminal) es el lugar de donde salen tus unidades. Con patios, cada jefe de tráfico ve y corrige
            lo suyo, la cola de liquidación se filtra por patio y las plantillas de carga masiva saben a dónde va cada
            camión.
            {patioDelJefe && <> Tú eres jefe de <strong>{patioDelJefe}</strong>: solo corriges operadores, unidades y jornadas de ese patio.</>}
          </p>

          {puedeAdministrar && (
            <section className="card p-4">
              <h2 className="font-display text-[15px] font-semibold mb-3">Crear un patio</h2>
              <FormaNuevoPatio accion={crear} />
            </section>
          )}

          <section className="card p-4">
            <h2 className="font-display text-[15px] font-semibold mb-3">Tus patios</h2>
            {ilegible ? (
              <EstadoError mensaje="No pude leer los patios de tu flota. No se enseña una lista a medias: parecería que faltan patios que sí existen." />
            ) : lista.length === 0 ? (
              <EstadoVacio icono={<MapPin width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                {puedeAdministrar
                  ? 'Todavía no hay patios. Crea el primero arriba: lo vas a necesitar para repartir tus camiones y tus jefes de tráfico. Si tu flota opera desde un solo lugar, puedes dejarlo así.'
                  : 'Tu flota todavía no tiene patios. Quien administra la cuenta los crea.'}
              </EstadoVacio>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <caption className="sr-only">Patios de la flota con sus operadores, unidades y jefes de tráfico</caption>
                  <thead>
                    <tr className="text-left" style={{ color: 'var(--faint)' }}>
                      <th scope="col" className="etiqueta-mono pb-2 text-[10px] font-normal uppercase">Patio</th>
                      <th scope="col" className="etiqueta-mono pb-2 text-right text-[10px] font-normal uppercase">Operadores</th>
                      <th scope="col" className="etiqueta-mono pb-2 text-right text-[10px] font-normal uppercase">Unidades</th>
                      <th scope="col" className="etiqueta-mono pb-2 text-right text-[10px] font-normal uppercase">Jefes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((p) => (
                      <FilaDePatio key={p.id} p={p} puedeAdministrar={puedeAdministrar} editar={editar} eliminar={eliminar} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[11.5px]" style={{ color: 'var(--faint)' }}>
              Los números cuentan solo operadores y unidades ACTIVOS. Gente y camiones se asignan a un patio desde su
              ficha en <Link href={hrefOperadores} className="underline">Operadores</Link> y <Link href={hrefUnidades} className="underline">Unidades</Link>,
              o con la columna «patio» de la carga masiva.
            </p>
          </section>

          {puedeAdministrar && lista.length > 0 && (
            <section className="card p-4 space-y-4">
              <div>
                <h2 className="font-display text-[15px] font-semibold flex items-center gap-1.5">
                  <UserCog aria-hidden width={15} height={15} strokeWidth={1.75} /> Jefes de tráfico
                </h2>
                <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                  Con un patio asignado, el jefe solo corrige operadores, unidades y jornadas de ese patio. Sin patio ve y
                  corrige toda la flota (un jefe de oficina central). Se invita al equipo desde Usuarios.
                </p>
              </div>
              {jefes === null ? (
                <EstadoError mensaje="No pude leer a tus jefes de tráfico. Vuelve a intentar." />
              ) : jefes.length === 0 ? (
                <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                  Todavía no tienes usuarios con el rol «Encargado (jefe de tráfico)». Invítalos desde Usuarios del equipo y aquí les asignas su patio.
                </p>
              ) : (
                <ul className="space-y-3">
                  {jefes.map((j) => (
                    <li key={j.userId}><FormaJefe accion={asignarJefe} jefe={j} patios={opciones} /></li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {puedeAdministrar && lista.length > 0 && sinPatio && (sinPatio.operadores > 0 || sinPatio.unidades > 0) && (
            <section className="card p-4 space-y-3">
              <div>
                <h2 className="font-display text-[15px] font-semibold flex items-center gap-1.5">
                  <Users aria-hidden width={15} height={15} strokeWidth={1.75} />
                  <Container aria-hidden width={15} height={15} strokeWidth={1.75} /> Lo que cargaste sin patio
                </h2>
                <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                  Si tu flota opera desde un solo patio, asígnalos de una vez. Si tienes varios, usa la columna «patio» de la
                  carga masiva o asigna uno por uno desde su ficha.
                </p>
              </div>
              <FormaSinPatio accion={asignarSinPatio} tabla="operador" cuantos={sinPatio.operadores} patios={opciones} />
              <FormaSinPatio accion={asignarSinPatio} tabla="unidad" cuantos={sinPatio.unidades} patios={opciones} />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function FilaDePatio({ p, puedeAdministrar, editar, eliminar }: {
  p: FilaPatio; puedeAdministrar: boolean; editar: AccionForma; eliminar: AccionForma;
}) {
  return (
    <>
      <tr className="border-t" style={{ borderColor: 'var(--line2)' }}>
        <th scope="row" className="py-2 text-left font-normal">
          <span className="block font-medium">{p.nombre}</span>
          {p.ciudad && <span className="block text-[11.5px]" style={{ color: 'var(--faint)' }}>{p.ciudad}</span>}
        </th>
        <td className="py-2 text-right cifra-mono">{numero(p.operadores)}</td>
        <td className="py-2 text-right cifra-mono">{numero(p.unidades)}</td>
        <td className="py-2 text-right cifra-mono">{numero(p.jefes)}</td>
      </tr>
      {puedeAdministrar && (
        <tr>
          <td colSpan={4} className="pb-3">
            <Plegable resumen="Editar o borrar este patio">
              <FormaEditarPatio accionEditar={editar} accionEliminar={eliminar} patio={p} />
            </Plegable>
          </td>
        </tr>
      )}
    </>
  );
}
