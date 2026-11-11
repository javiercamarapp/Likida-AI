'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import { ComboCatalogo, type BuscarCatalogo } from '../combo-catalogo';
import { AvisoResultado, Boton as BotonDs, CampoFecha, CampoSelect, CampoTexto, Casilla, Disclosure, Icono } from '@/app/ui-v2/componentes';
import './clientes.css';
// SOLO TIPOS DE `clientes.ts`, y es una restricción real, no un gusto: ese
// módulo importa `supabaseAdmin`, cuyo encabezado dice textualmente "NUNCA
// importar en código de cliente". Un `import` de valor (por ejemplo del
// catálogo `MODOS_TARIFA`) arrastraría la llave de servicio al bundle del
// navegador aunque el componente no la use. Los `import type` se borran al
// compilar; el catálogo viaja como PROP desde la página, que sí es servidor.
import type { ClienteCrudo, TarifaCruda } from '@/lib/likida/clientes';

export type ResultadoForma = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

function Boton({ etiqueta }: { etiqueta: string }) {
  const { pending } = useFormStatus();
  return (
    <BotonDs type="submit" variante="primary" loading={pending} icono={<Icono icono={Save} />} className="rv-cl__guardar">
      {pending ? 'Guardando…' : etiqueta}
    </BotonDs>
  );
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
export function FormaCliente({ accion, id = '', inicial, idPrefijo }: {
  accion: AccionForma;
  id?: string;
  inicial: ClienteCrudo;
  /** Prefijo para los `id` del DOM: esta forma se repite por renglón y dos
   *  `<label for="nombre">` en la misma página apuntan al primero. */
  idPrefijo: string;
}) {
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `${idPrefijo}-${n}`;

  return (
    <form action={despachar} className="rv-forma">
      <input type="hidden" name="id" value={id} />

      <div className="rv-forma__rejilla">
        <CampoTexto id={campo('nombre')} name="nombre" etiqueta="Nombre o razón social" obligatorio maxLength={120}
          defaultValue={inicial.nombre} placeholder="Cementos del Bajío S.A. de C.V." className="rv-cl__ancho" />
        <CampoTexto id={campo('rfc')} name="rfc" etiqueta="RFC" maxLength={13} defaultValue={inicial.rfc} placeholder="Opcional"
          ayuda="Se le revisa el dígito verificador. Es el RFC con el que le vas a facturar." />
        {/* La distinción que sostiene la cobranza entera: vacío ≠ 0. */}
        <CampoTexto id={campo('dias')} name="diasCredito" tipo="number" etiqueta="Días de crédito" min={0} max={365} step={1}
          defaultValue={inicial.diasCredito} placeholder="Déjalo vacío si no hay crédito pactado"
          ayuda="Vacío = sin condiciones pactadas (sus facturas no llevan fecha de vencimiento). Un 0 significa contado." />
        <CampoTexto id={campo('contacto')} name="contacto" etiqueta="Contacto" maxLength={120} defaultValue={inicial.contacto} placeholder="Quién autoriza pagos" />
        <CampoTexto id={campo('correo')} name="correo" tipo="email" etiqueta="Correo" maxLength={160} defaultValue={inicial.correo} placeholder="cuentasporpagar@empresa.com" />
        <CampoTexto id={campo('telefono')} name="telefono" etiqueta="Teléfono" maxLength={40} defaultValue={inicial.telefono}
          placeholder="477 123 4567 ext. 210" className="rv-cl__ancho" />
      </div>

      <Casilla name="activo" defaultChecked={inicial.activo} etiqueta="Cliente activo" />

      <Aviso estado={estado} />
      <Boton etiqueta={id ? 'Guardar cambios' : 'Dar de alta'} />
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
  accion, id = '', inicial, clienteNombre = '', idPrefijo, buscarCliente, totalClientes, modos,
}: {
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
  const [estado, despachar] = useActionState(accion, null);
  const campo = (n: string) => `${idPrefijo}-${n}`;

  return (
    <form action={despachar} className="rv-forma">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="moneda" value="MXN" />

      <div className="rv-forma__rejilla">
        <div className="rv-campo rv-cl__ancho">
          <label htmlFor={campo('cliente')} className="rv-campo__etq">Cliente</label>
          <ComboCatalogo tipo="cliente" name="clienteId" campoId={campo('cliente')}
            buscar={buscarCliente} aria-label="Cliente"
            etiquetaVacia="Tarifa de lista — aplica a cualquier cliente"
            valorInicial={inicial.clienteId || null} textoInicial={clienteNombre}
            total={totalClientes} className="rv-ctl" />
          <span className="rv-campo__ayuda">
            Una tarifa con cliente es negociada, y le gana a la de lista. Déjalo vacío para una tarifa de lista.
          </span>
        </div>

        <CampoTexto id={campo('origen')} name="origen" etiqueta="Origen" maxLength={120} defaultValue={inicial.origen} placeholder="Vacío = cualquiera" />
        <CampoTexto id={campo('destino')} name="destino" etiqueta="Destino" maxLength={120} defaultValue={inicial.destino} placeholder="Vacío = cualquiera" />

        <CampoSelect id={campo('modo')} name="modo" etiqueta="Cómo se cobra" defaultValue={inicial.modo}
          ayuda={modos.map((m) => `${m.rotulo}: ${m.detalle}`).join(' ')}>
          {modos.map((m) => (
            <option key={m.valor} value={m.valor}>{m.rotulo}</option>
          ))}
        </CampoSelect>

        <CampoTexto id={campo('precio')} name="precio" etiqueta="Precio (MXN)" obligatorio inputMode="decimal"
          defaultValue={inicial.precio} placeholder="28,500.00"
          ayuda="En la unidad que elegiste arriba. Solo pesos: Likida todavía no convierte moneda." />

        <CampoFecha id={campo('desde')} name="vigenteDesde" etiqueta="Rige desde" obligatorio defaultValue={inicial.vigenteDesde} />
        <CampoFecha id={campo('hasta')} name="vigenteHasta" etiqueta="Rige hasta" defaultValue={inicial.vigenteHasta}
          ayuda="Vacío = sin fecha de término. El último día pactado la tarifa todavía rige." />
      </div>

      <Casilla name="activa" defaultChecked={inicial.activa} etiqueta="Tarifa activa" />

      <Aviso estado={estado} />
      <Boton etiqueta={id ? 'Guardar cambios' : 'Agregar tarifa'} />
    </form>
  );
}
