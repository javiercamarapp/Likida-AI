'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';
import { ComboCatalogo, type BuscarCatalogo } from './combo-catalogo';
import { mxn } from '@/lib/formato';
import { Aviso, Boton, CampoFecha, CampoTexto, Icono } from '@/app/ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { dashboard_b as dashboard_bEs } from '@/lib/i18n/es/dashboard_b';

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
  const { t } = useT('dashboard_b', dashboard_bEs);
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Plus} />}>
      {pending ? t('fv.creando') : t('fv.crear')}
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
  const { t } = useT('dashboard_b', dashboard_bEs);
  const [estado, dispatch] = useActionState(action, null);

  return (
    <form action={dispatch} className="rv-forma">
      <div className="rv-forma__rejilla">
        <CampoTexto id="folio" etiqueta={t('fv.folio')} name="folio" maxLength={40} placeholder={t('fv.folio_ph')} claseControl="cifra-mono" />
        <CampoFecha id="fechaInicio" etiqueta={t('fv.fecha_inicio')} name="fechaInicio" />
        <CampoTexto id="origen" etiqueta={t('fv.origen')} name="origen" maxLength={120} placeholder={t('fv.origen_ph')} />
        <CampoTexto id="destino" etiqueta={t('fv.destino')} name="destino" maxLength={120} placeholder={t('fv.destino_ph')} />
        {puedeCapturarAnticipo && (
          <CampoTexto id="anticipo" etiqueta={t('fv.anticipo')} name="anticipo" tipo="number" min={0} max={topeAnticipo} step="0.01" placeholder={t('fv.anticipo_ph')} claseControl="cifra-mono"
            ayuda={topeAnticipo === undefined ? undefined : topeAnticipoOrigen === 'politica'
              ? t('fv.anticipo_tope_politica', { monto: mxn(topeAnticipo) })
              : t('fv.anticipo_tope_umbral', { monto: mxn(topeAnticipo) })} />
        )}
        <div className="rv-campo">
          <label htmlFor="operadorId" className="rv-campo__etq">{t('fv.operador')}</label>
          {/* SIN "Sin asignar todavía". `viaje.operador_id` es NOT NULL desde la
              0001, así que esa opción no creaba un viaje sin operador: tronaba
              con un 23502 y el usuario veía "No se pudo crear el viaje" sin
              saber por qué. Verificado contra producción el 14-ago-2026.
              Ofrecer una opción que la base rechaza es peor que no ofrecerla. */}
          <ComboCatalogo tipo="operador" name="operadorId" campoId="operadorId" buscar={buscarCatalogo} requerido
            aria-label={t('fv.operador')} etiquetaVacia={t('fv.operador_vacia')}
            total={totalOperadores} className="w-full" />
          <span className="rv-campo__ayuda">
            {totalOperadores === 0
              ? t('fv.operador_sin')
              : t('fv.operador_aviso')}
          </span>
        </div>
        {totalUnidades === 0 ? (
          // Campo con estado vacío (no un párrafo): deshabilitado, sin `name`, y dice dónde se resuelve.
          <CampoTexto id="unidadId" etiqueta={t('fv.unidad')} disabled placeholder={t('fv.unidad_ph')} ayuda={t('fv.unidad_ayuda')} />
        ) : (
          <div className="rv-campo">
            <label htmlFor="unidadId" className="rv-campo__etq">{t('fv.unidad')}</label>
            <ComboCatalogo tipo="unidad" name="unidadId" campoId="unidadId" buscar={buscarCatalogo}
              aria-label={t('fv.unidad')} etiquetaVacia={t('fv.sin_asignar')}
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
        <legend className="rv-forma__leyenda">{t('fv.ingreso_leyenda')}</legend>

        <div className="rv-forma__rejilla">
          {totalClientes === 0 ? (
            <CampoTexto id="clienteId" etiqueta={t('fv.cliente')} disabled placeholder={t('fv.cliente_ph')} ayuda={t('fv.cliente_ayuda')} />
          ) : (
            <div className="rv-campo">
              <label htmlFor="clienteId" className="rv-campo__etq">{t('fv.cliente')}</label>
              <ComboCatalogo tipo="cliente" name="clienteId" campoId="clienteId" buscar={buscarCatalogo}
                aria-label={t('fv.cliente')} etiquetaVacia={t('fv.sin_asignar')}
                total={totalClientes} className="w-full" />
            </div>
          )}
          <CampoTexto id="ingresoFlete" etiqueta={t('fv.ingreso')} name="ingresoFlete" inputMode="decimal" placeholder={t('fv.ingreso_ph')} claseControl="cifra-mono"
            ayuda={t('fv.ingreso_ayuda')} />
          <CampoTexto id="kmRecorridos" etiqueta={t('fv.km')} name="kmRecorridos" inputMode="numeric" placeholder={t('fv.km_ph')} claseControl="cifra-mono" />
        </div>

        <p className="rv-campo__ayuda">
          {t('fv.ingreso_nota')}
        </p>
      </fieldset>}

      {!puedeCapturarDinero && (
        <CampoTexto id="kmRecorridos" etiqueta={t('fv.km')} name="kmRecorridos" inputMode="numeric" placeholder={t('fv.km_ph')} claseControl="cifra-mono" />
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
