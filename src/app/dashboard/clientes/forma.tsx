'use client';

import { useActionState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import { ComboCatalogo, type BuscarCatalogo } from '../combo-catalogo';
import { AvisoResultado, Boton as BotonDs, Drawer, type AccionDeForma, type ResultadoAccion, CampoFecha, CampoSelect, CampoTexto, Casilla, Disclosure, Icono } from '@/app/ui-v2/componentes';
import './clientes.css';
// SOLO TIPOS DE `clientes.ts`, y es una restricción real, no un gusto: ese
// módulo importa `supabaseAdmin`, cuyo encabezado dice textualmente "NUNCA
// importar en código de cliente". Un `import` de valor (por ejemplo del
// catálogo `MODOS_TARIFA`) arrastraría la llave de servicio al bundle del
// navegador aunque el componente no la use. Los `import type` se borran al
// compilar; el catálogo viaja como PROP desde la página, que sí es servidor.
import type { ClienteCrudo, TarifaCruda } from '@/lib/likida/clientes';
import { useT } from '@/lib/i18n/proveedor';
import { operacion as operacionEs } from '@/lib/i18n/es/operacion';

/** Cajón del alta (Rovaq: «Nuevo …» abre un cajón, no un bloque plegado en la página). Nace abierto cuando la URL trae `?nuevo=`; al cerrar
 *  navega a la misma pantalla sin ese parámetro (`hrefCerrar`). Foco, Esc, fondo y hoja inferior en móvil los da `Drawer`. */
export function CajonAlta({ titulo, hrefCerrar, ancho = 'm', idPrefijo, children }: { titulo: string; hrefCerrar: string; ancho?: 'm' | 'xl'; idPrefijo?: string; children: React.ReactNode }) {
  const router = useRouter();
  // Rovaq: la acción principal vive en el pie del cajón (overlay-foot), a la derecha. La forma portala ahí su botón de envío.
  return (
    <Drawer abierto onCerrar={() => router.replace(hrefCerrar, { scroll: false })} titulo={titulo} tamano={ancho}
      pie={idPrefijo ? <div id={`${idPrefijo}-pie`} className="rv-cl__pie-cajon" /> : undefined}>
      {children}
    </Drawer>
  );
}

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

const SIN_SUSCRIPCION = () => () => {};
/** El nodo del pie de un cajón (null en el servidor y en el primer render; ya existe cuando el cajón está montado). */
function usePieDe(prefijo: string | undefined): HTMLElement | null {
  return useSyncExternalStore(SIN_SUSCRIPCION, () => (prefijo ? document.getElementById(`${prefijo}-pie`) : null), () => null);
}

function Boton({ etiqueta, enPie }: { etiqueta: string; /** Prefijo de la forma que vive en un cajón: el botón se monta en su pie. */ enPie?: string }) {
  const { t } = useT('operacion', operacionEs);
  const { pending } = useFormStatus();
  const pie = usePieDe(enPie);
  const boton = (
    <BotonDs type="submit" form={enPie ? `${enPie}-forma` : undefined} variante="primary" loading={pending} icono={<Icono icono={Save} />} className="rv-cl__guardar">
      {pending ? t('cli.f.guardando') : etiqueta}
    </BotonDs>
  );
  // Mientras el pie no existe (primer render) el botón queda en la forma; al montarse se mueve al pie del cajón.
  return enPie && pie ? createPortal(boton, pie) : boton;
}

/** El aviso del resultado: el UNICO del panel. El error del servidor se enseña VERBATIM: los `DatoInvalido` están escritos para leerse aquí. */
const Aviso = AvisoResultado;

/**
 * Un bloque que se abre. `<details>` nativo y no `useState` a propósito: sin
 * JavaScript sigue abriendo, y una pantalla con 40 clientes tendría 40 estados
 * de React vivos para no enseñar nada.
 */
export function Plegable({ resumen, children }: { resumen: string; children: React.ReactNode }) {
  return <Disclosure variante="linea" titulo={resumen}>{children}</Disclosure>;
}

// ── Cliente ────────────────────────────────────────────────────────────────

/**
 * Alta y edición de un cliente, EL MISMO formulario.
 *
 * `id` vacío = alta. Y el `id` viaja en un campo oculto sin que eso sea un
 * agujero: el server action NO saca de aquí el tenant —lo re-resuelve de la
 * sesión— y el UPDATE va anclado con `.eq('tenant_id', ...)`, así que el id de
 * un cliente de otra flota no encuentra fila y sale como error, no como
 * "guardado". El campo oculto dice QUÉ fila, nunca DE QUIÉN.
 */
export function FormaCliente({ accion, id = '', inicial, idPrefijo, enCajon = false }: {
  /** La forma vive en un cajón de alta: su botón de envío va al pie del cajón. */
  enCajon?: boolean;
  accion: AccionForma;
  id?: string;
  inicial: ClienteCrudo;
  /** Prefijo para los `id` del DOM: esta forma se repite por renglón y dos
   *  `<label for="nombre">` en la misma página apuntan al primero. */
  idPrefijo: string;
}) {
  const { t } = useT('operacion', operacionEs);
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `${idPrefijo}-${n}`;

  return (
    <form action={despachar} className="rv-forma" id={enCajon ? `${idPrefijo}-forma` : undefined}>
      <input type="hidden" name="id" value={id} />

      <div className="rv-forma__rejilla">
        <CampoTexto id={campo('nombre')} name="nombre" etiqueta={t('cli.f.nombre')} obligatorio maxLength={120}
          defaultValue={inicial.nombre} placeholder={t('cli.f.nombre.ph')} className="rv-cl__ancho" />
        <CampoTexto id={campo('rfc')} name="rfc" etiqueta="RFC" maxLength={13} defaultValue={inicial.rfc} placeholder={t('cli.f.opcional')}
          ayuda={t('cli.f.rfc.ayuda')} />
        {/* La distinción que sostiene la cobranza entera: vacío ≠ 0. */}
        <CampoTexto id={campo('dias')} name="diasCredito" tipo="number" etiqueta={t('cli.f.credito')} min={0} max={365} step={1}
          defaultValue={inicial.diasCredito} placeholder={t('cli.f.credito.ph')}
          ayuda={t('cli.f.credito.ayuda')} />
        <CampoTexto id={campo('contacto')} name="contacto" etiqueta={t('cli.f.contacto')} maxLength={120} defaultValue={inicial.contacto} placeholder={t('cli.f.contacto.ph')} />
        <CampoTexto id={campo('correo')} name="correo" tipo="email" etiqueta={t('cli.f.correo')} maxLength={160} defaultValue={inicial.correo} placeholder="cuentasporpagar@empresa.com" />
        <CampoTexto id={campo('telefono')} name="telefono" etiqueta={t('cli.f.telefono')} maxLength={40} defaultValue={inicial.telefono}
          placeholder={t('cli.f.telefono.ph')} className="rv-cl__ancho" />
      </div>

      <Casilla name="activo" defaultChecked={inicial.activo} etiqueta={t('cli.f.activo')} />

      <Aviso estado={estado} />
      <Boton etiqueta={id ? t('cli.f.guardar') : t('cli.f.alta')} enPie={enCajon ? idPrefijo : undefined} />
    </form>
  );
}

// ── Tarifa ─────────────────────────────────────────────────────────────────

export interface OpcionModo {
  valor: string;
  rotulo: string;
  unidad: string;
  detalle: string;
}

/**
 * Alta y edición de una tarifa.
 *
 * El precio es `type="text"` y no `type="number"` a propósito: un contralor
 * pega "28,500.50" desde su Excel y un input numérico lo descarta ENTERO al
 * enviar —queda vacío y el error que ve es "falta el precio"—, cuando el
 * validador del servidor sí sabe leer la coma y el separador de millares.
 */
export function FormaTarifa({
  accion, id = '', inicial, clienteNombre = '', idPrefijo, buscarCliente, totalClientes, modos, enCajon = false,
}: {
  enCajon?: boolean;
  accion: AccionForma;
  id?: string;
  inicial: TarifaCruda;
  /** El nombre del cliente que `inicial.clienteId` nombra — llega resuelto
   *  desde la página para que el buscador arranque lleno sin catálogo. */
  clienteNombre?: string;
  idPrefijo: string;
  /** FE-12/FE-2: el catálogo de clientes YA NO viaja como `<option>`. Aquí
   *  había un `<select>` con TODOS los clientes activos, dentro de una forma
   *  que se pintaba POR CADA TARIFA — el catálogo entero repetido N veces.
   *  Ahora es el buscador del servidor (20 a la vez). */
  buscarCliente: BuscarCatalogo;
  /** Cuántos clientes activos hay (count exact); `null` = no se pudo contar. */
  totalClientes: number | null;
  modos: ReadonlyArray<OpcionModo>;
}) {
  const { t } = useT('operacion', operacionEs);
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `${idPrefijo}-${n}`;

  return (
    <form action={despachar} className="rv-forma" id={enCajon ? `${idPrefijo}-forma` : undefined}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="moneda" value="MXN" />

      <div className="rv-forma__rejilla">
        <div className="rv-campo rv-cl__ancho">
          <label htmlFor={campo('cliente')} className="rv-campo__etq">{t('cli.f.cliente')}</label>
          <ComboCatalogo tipo="cliente" name="clienteId" campoId={campo('cliente')}
            buscar={buscarCliente} aria-label={t('cli.f.cliente')}
            etiquetaVacia="Tarifa de lista — aplica a cualquier cliente"
            valorInicial={inicial.clienteId || null} textoInicial={clienteNombre}
            total={totalClientes} className="rv-ctl" />
          <span className="rv-campo__ayuda">
            {t('cli.f.tarifa.ayuda')}
          </span>
        </div>

        <CampoTexto id={campo('origen')} name="origen" etiqueta={t('cli.f.origen')} maxLength={120} defaultValue={inicial.origen} placeholder={t('cli.f.cualquiera')} />
        <CampoTexto id={campo('destino')} name="destino" etiqueta={t('cli.f.destino')} maxLength={120} defaultValue={inicial.destino} placeholder={t('cli.f.cualquiera')} />

        <CampoSelect id={campo('modo')} name="modo" etiqueta={t('cli.f.comocobra')} defaultValue={inicial.modo}
          ayuda={modos.map((m) => `${m.rotulo}: ${m.detalle}`).join(' ')}>
          {modos.map((m) => (
            <option key={m.valor} value={m.valor}>{m.rotulo}</option>
          ))}
        </CampoSelect>

        <CampoTexto id={campo('precio')} name="precio" etiqueta={t('cli.f.precio')} obligatorio inputMode="decimal"
          defaultValue={inicial.precio} placeholder="28,500.00"
          ayuda={t('cli.f.precio.ayuda')} />

        <CampoFecha id={campo('desde')} name="vigenteDesde" etiqueta={t('cli.f.desde')} obligatorio defaultValue={inicial.vigenteDesde} />
        <CampoFecha id={campo('hasta')} name="vigenteHasta" etiqueta={t('cli.f.hasta')} defaultValue={inicial.vigenteHasta}
          ayuda={t('cli.f.hasta.ayuda')} />
      </div>

      <Casilla name="activa" defaultChecked={inicial.activa} etiqueta={t('cli.f.tarifa.activa')} />

      <Aviso estado={estado} />
      <Boton etiqueta={id ? t('cli.f.guardar') : t('cli.f.tarifa.agregar')} enPie={enCajon ? idPrefijo : undefined} />
    </form>
  );
}


/**
 * Forma de un cajón de alta con acciones `ResultadoAccion` (cotizaciones): igual que `FormaConAviso`, pero la acción principal va en el
 * pie del cajón, a la derecha (Rovaq overlay-foot), y no debajo del último campo. El botón se monta en el pie del `CajonAlta` con el mismo
 * `idPrefijo`; el envío sigue siendo de la forma (atributo `form`) y se deshabilita mientras corre.
 */
export function FormaDeCajon({ accion, boton, idPrefijo, children }: { accion: AccionDeForma; boton: string; idPrefijo: string; children: React.ReactNode }) {
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  const pie = usePieDe(idPrefijo);
  const b = (
    <BotonDs type="submit" form={`${idPrefijo}-forma`} variante="primary" disabled={pendiente} aria-busy={pendiente || undefined} className="rv-cl__guardar">
      {pendiente ? 'Guardando…' : boton}
    </BotonDs>
  );
  return (
    <form action={enviar} id={`${idPrefijo}-forma`} className="rv-forma">
      {children}
      <AvisoResultado estado={estado} />
      {pie ? createPortal(b, pie) : b}
    </form>
  );
}
