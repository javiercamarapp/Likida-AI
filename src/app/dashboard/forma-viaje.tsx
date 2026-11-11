'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';
import { ComboCatalogo, type BuscarCatalogo } from './combo-catalogo';
import { mxn } from '@/lib/formato';
import { Aviso, Boton, CampoFecha, CampoTexto, Icono } from '@/app/ui-v2/componentes';

/**
 * El formulario de NUEVO VIAJE — pieza REUSABLE a propósito (12-ago-2026):
 * la embebe Despacho (la página suelta /viajes/nuevo se retiró el 13-ago), que
 * es la siguiente página por reconstruir. Presentación pura: la mutación
 * llega como server action del host, que es quien re-verifica permisos
 * adentro (el patrón del repo: el gateo de la UI solo decide si se pinta).
 *
 * Campos = los de `NuevoViaje` (operacion.ts). La unidad ya se ofrece aquí
 * (14-ago-2026): `viaje.unidad_id` es nullable, así que "Sin asignar todavía"
 * es una opción que la base sí admite — a diferencia del operador.
 *
 * FE-2 (22-ago-2026): los tres catálogos (operador, unidad, cliente) YA NO
 * viajan como `<option>`. A 7,500 choferes y 5,000 unidades eran cientos de
 * KB de HTML por carga — y encima recortados a 1,000 en silencio por
 * PostgREST, así que el chofer 1,001 no se podía elegir. Ahora son
 * `ComboCatalogo`: se busca en el servidor al escribir, 20 a la vez, y lo que
 * se manda sigue siendo el id.
 */

export type AccionCrearViaje = (
  prev: { error?: string } | null,
  fd: FormData,
) => Promise<{ error?: string } | null>;

function BotonCrear() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Plus} />}>
      {pending ? 'Creando…' : 'Crear viaje'}
    </Boton>
  );
}

export function FormaViaje({ action, buscarCatalogo, totalOperadores, totalClientes, totalUnidades, puedeCapturarDinero = false, puedeCapturarAnticipo = puedeCapturarDinero, topeAnticipo, topeAnticipoOrigen = 'politica' }: {
  action: AccionCrearViaje;
  /** Sólo visibilidad; la acción vuelve a exigir el permiso de la sesión viva. */
  puedeCapturarDinero?: boolean;
  /** El anticipo lo captura quien despacha (E1-B), aunque no vea dinero. Por
   *  defecto sigue a `puedeCapturarDinero` (otros hosts no cambian). */
  puedeCapturarAnticipo?: boolean;
  /** Tope de anticipo de la política de la flota, solo para mostrarlo: lo hace
   *  cumplir la acción del servidor. */
  topeAnticipo?: number;
  /** De dónde sale el tope: la política de la flota, o el umbral de revisión (cuando no declaró uno). */
  topeAnticipoOrigen?: 'politica' | 'umbral_revision';
  /** La búsqueda de catálogos en el servidor (server action del host, con el
   *  tenant por closure). Una sola referencia para los tres combos. */
  buscarCatalogo: BuscarCatalogo;
  /** Cuántos operadores activos hay — `count exact, head`, sin traer ninguno.
   *  `0` = todavía no hay ninguno dado de alta, y se dice; `null` = no se pudo
   *  contar, y entonces NO se afirma que falten (la base caída no es un
   *  catálogo vacío). */
  totalOperadores: number | null;
  /** Los clientes de la flota, para atar el viaje a quien paga el flete.
   *  Mismo contrato que `totalOperadores`. */
  totalClientes: number | null;
  /** Las unidades activas de la flota. Mismo contrato. */
  totalUnidades: number | null;
}) {
  const [estado, dispatch] = useActionState(action, null);

  return (
    <form action={dispatch} className="rv-forma">
      <div className="rv-forma__rejilla">
        <CampoTexto id="folio" etiqueta="Folio" name="folio" maxLength={40} placeholder="F-0148" claseControl="cifra-mono" />
        <CampoFecha id="fechaInicio" etiqueta="Fecha de inicio" name="fechaInicio" />
        <CampoTexto id="origen" etiqueta="Origen" name="origen" maxLength={120} placeholder="Silao" />
        <CampoTexto id="destino" etiqueta="Destino" name="destino" maxLength={120} placeholder="Monterrey" />
        {puedeCapturarAnticipo && (
          <CampoTexto id="anticipo" etiqueta="Anticipo (MXN)" name="anticipo" tipo="number" min={0} max={topeAnticipo} step="0.01" placeholder="8000" claseControl="cifra-mono"
            ayuda={topeAnticipo === undefined ? undefined : topeAnticipoOrigen === 'politica'
              ? `Tope de la política de tu flota: ${mxn(topeAnticipo)}`
              : `Umbral de revisión: ${mxn(topeAnticipo)} (arriba de eso lo captura el dueño)`} />
        )}
        <div className="rv-campo">
          <label htmlFor="operadorId" className="rv-campo__etq">Operador</label>
          {/* SIN "Sin asignar todavía". `viaje.operador_id` es NOT NULL desde la
              0001, así que esa opción no creaba un viaje sin operador: tronaba
              con un 23502 y el usuario veía "No se pudo crear el viaje" sin
              saber por qué. Verificado contra producción el 14-ago-2026.
              Ofrecer una opción que la base rechaza es peor que no ofrecerla. */}
          <ComboCatalogo tipo="operador" name="operadorId" campoId="operadorId" buscar={buscarCatalogo} requerido
            aria-label="Operador" etiquetaVacia="Escribe el nombre del chofer…"
            total={totalOperadores} className="w-full" />
          <span className="rv-campo__ayuda">
            {totalOperadores === 0
              ? 'Necesitas al menos un operador dado de alta: un viaje no puede existir sin quién lo maneje. El alta rápida está a la derecha.'
              : 'Likida le avisa por WhatsApp en cuanto el viaje exista.'}
          </span>
        </div>
        {totalUnidades === 0 ? (
          // Campo con estado vacío (no un párrafo): deshabilitado, sin `name`, y dice dónde se resuelve.
          <CampoTexto id="unidadId" etiqueta="Unidad" disabled placeholder="Sin unidades dadas de alta" ayuda="Se registran en Unidades." />
        ) : (
          <div className="rv-campo">
            <label htmlFor="unidadId" className="rv-campo__etq">Unidad</label>
            <ComboCatalogo tipo="unidad" name="unidadId" campoId="unidadId" buscar={buscarCatalogo}
              aria-label="Unidad" etiquetaVacia="Sin asignar todavía"
              total={totalUnidades} className="w-full cifra-mono" />
          </div>
        )}
      </div>

      {/* ── EL LADO DEL INGRESO ──────────────────────────────────────────
          Va en su propio bloque, DESPUÉS de lo operativo y visualmente
          separado, porque son datos de otra naturaleza y de otra persona: lo
          de arriba lo llena el jefe de tráfico al despachar, esto lo llena
          quien conoce lo que se le cobra al cliente. Juntos en la misma
          cuadrícula, el anticipo y el ingreso se confunden — y confundirlos
          produce márgenes que se ven bien y están mal. */}
      {puedeCapturarDinero && <fieldset className="rv-forma__ingreso">
        <legend className="rv-forma__leyenda">Lo que se le cobra al cliente · opcional</legend>

        <div className="rv-forma__rejilla">
          {totalClientes === 0 ? (
            <CampoTexto id="clienteId" etiqueta="Cliente" disabled placeholder="Sin clientes dados de alta" ayuda="Se registran en Clientes y tarifas." />
          ) : (
            <div className="rv-campo">
              <label htmlFor="clienteId" className="rv-campo__etq">Cliente</label>
              <ComboCatalogo tipo="cliente" name="clienteId" campoId="clienteId" buscar={buscarCatalogo}
                aria-label="Cliente" etiquetaVacia="Sin asignar todavía"
                total={totalClientes} className="w-full" />
            </div>
          )}
          <CampoTexto id="ingresoFlete" etiqueta="Ingreso del flete (MXN)" name="ingresoFlete" inputMode="decimal" placeholder="38,500" claseControl="cifra-mono"
            ayuda="Lo que le cobras al cliente, NO el anticipo. Vacío no es cero." />
          <CampoTexto id="kmRecorridos" etiqueta="Kilómetros" name="kmRecorridos" inputMode="numeric" placeholder="1,240" claseControl="cifra-mono" />
        </div>

        <p className="rv-campo__ayuda">
          Sin el ingreso capturado, este viaje no entra en la medición de margen — ni la suya ni la de
          su ruta, su cliente o su unidad. Se puede llenar después.
        </p>
      </fieldset>}

      {!puedeCapturarDinero && (
        <CampoTexto id="kmRecorridos" etiqueta="Kilómetros" name="kmRecorridos" inputMode="numeric" placeholder="1,240" claseControl="cifra-mono" />
      )}

      {estado?.error && (
        <Aviso tono="error">{estado.error}</Aviso>
      )}

      {/* El primario va en un pie fijo del cajón (Rovaq `overlay-foot`: padding 12x16, acciones a la derecha), no suelto al final del cuerpo. */}
      <div className="rv-fv__pie">
        <BotonCrear />
      </div>
    </form>
  );
}
