import {
  Handshake, Banknote, Wallet, Users, Route, TriangleAlert, CircleDashed,
} from 'lucide-react';
import type {
  PanelClientes, ClienteConMetricas, TarifaRow, ViajeSinIngreso,
} from '@/lib/likida/clientes';
import { StatCard, EstadoVacio, EstadoError } from '@/app/admin/ui/kit';
// El formato de cifras vive SOLO en formato.ts — hay una prueba que falla si
// otro archivo formatea moneda mexicana por su cuenta.
import { mxn, numero, fechaMx } from '@/lib/formato';
import { BarraPagina } from '../resumen-visual';
import { FormaCliente, FormaTarifa, Plegable, type AccionForma, type OpcionModo } from './forma';

/**
 * CLIENTES Y TARIFAS — el lado del INGRESO, que hasta hoy no tenía pantalla.
 *
 * La 0048 creó `cliente` y `tarifa` en agosto y desde entonces siguen vacías:
 * no por falta de esquema, por falta de captura. Mientras lo estén, Likida ve
 * lo que la flota GASTA y no lo que COBRA — y sin eso no hay margen por
 * cliente, ni cartera, ni forma de saber que la mitad del ingreso depende de
 * un solo teléfono.
 *
 * TRES ESTADOS POR BLOQUE, como en Rentabilidad: dato real, vacío que dice qué
 * lo enciende, o el error DICHO. Lo que no se hace en ninguno de los tres es
 * rellenar con un cero: un cliente sin facturas no debe $0.00, se le desconoce
 * el saldo; un viaje sin ingreso capturado no valió $0, no se ha capturado.
 *
 * Pura props a propósito, para poder mirarla con fixtures sin sesión.
 */
export function VistaClientes({
  panel, puedeEditar, modos, guardarCliente, guardarTarifa,
}: {
  panel: PanelClientes | null;
  puedeEditar: boolean;
  modos: ReadonlyArray<OpcionModo>;
  guardarCliente: AccionForma;
  guardarTarifa: AccionForma;
}) {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Handshake width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Clientes y tarifas"
        />

        <div className="px-5 py-5 flex-1 space-y-4">
          {panel === null ? (
            <EstadoError mensaje="No pude leer tus clientes, tarifas y facturas. No se enseña una cartera a medias: media tabla sumada se ve igual que la tabla entera." />
          ) : (
            <>
              <BloqueCartera panel={panel} />
              <BloqueClientes panel={panel} puedeEditar={puedeEditar} guardarCliente={guardarCliente} />
              <BloqueTarifas panel={panel} puedeEditar={puedeEditar} modos={modos} guardarTarifa={guardarTarifa} />
              <BloqueSinIngreso panel={panel} />
              {!puedeEditar && (
                <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
                  Tu rol ve esta pantalla pero no da de alta clientes ni tarifas: el catálogo de precios
                  es una decisión del dueño de la flota.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/** "1 viaje" / "14 viajes". El "(s)" de paréntesis se lee como plantilla sin
 *  terminar, y esta pantalla la lee un contralor. */
function plural(n: number, uno: string, varios: string): string {
  return `${numero(n)} ${n === 1 ? uno : varios}`;
}

// ── Los tres números de arriba ─────────────────────────────────────────────

function BloqueCartera({ panel }: { panel: PanelClientes }) {
  // Sin un solo cliente no hay nada que medir, y tres tarjetas en cero se leen
  // como "esta flota no cobra nada". El bloque entero se calla.
  if (panel.clientes.length === 0) return null;

  const activos = panel.clientes.filter((c) => c.activo).length;
  const conFacturas = panel.clientes.filter((c) => c.facturas > 0);
  const porCobrar = conFacturas.reduce((s, c) => s + (c.saldoPorCobrar ?? 0), 0);

  return (
    <section className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          icono={<Banknote width={14} height={14} strokeWidth={1.75} />}
          etiqueta="Ingreso de fletes capturado" valor={panel.ingresoTotal} formato="mxn"
          nota={panel.conIngreso === 0
            ? 'Ningún viaje trae ingreso capturado todavía'
            : `De ${plural(panel.conIngreso, 'viaje', 'viajes')} con el dato capturado`}
        />
        <StatCard
          icono={<Users width={14} height={14} strokeWidth={1.75} />}
          etiqueta="Clientes activos" valor={activos} formato="numero"
          nota={panel.clientes.length !== activos
            ? `${plural(panel.clientes.length - activos, 'dado de baja', 'dados de baja')}`
            : undefined}
        />
        {conFacturas.length > 0 ? (
          <StatCard
            icono={<Wallet width={14} height={14} strokeWidth={1.75} />}
            etiqueta="Por cobrar a clientes" valor={porCobrar} formato="mxn"
            nota={`De ${plural(conFacturas.length, 'cliente', 'clientes')} con facturas registradas`}
          />
        ) : (
          <div className="card p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>
            <span className="block font-medium" style={{ color: 'var(--ink)' }}>Por cobrar</span>
            Ninguno de tus clientes tiene facturas registradas todavía, así que no hay saldo que
            sumar. No es cero: es que aún no se ha registrado una factura emitida.
          </div>
        )}
      </div>

      {panel.concentracion !== null && (
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
          El cliente más grande representa el <strong>{panel.concentracion}%</strong> del ingreso capturado
          {panel.concentracion > 50 && ' — más de la mitad de lo que cobra tu flota depende de una sola cuenta'}.
          Medido solo sobre los viajes que traen ingreso; los que no, no entran.
        </p>
      )}

      {panel.viajesSinCliente > 0 && (
        <p className="text-[12px]" style={{ color: 'var(--warn)' }}>
          {panel.viajesSinCliente === 1
            ? '1 viaje no tiene cliente asignado, así que su ingreso no aparece en ninguna fila de abajo.'
            : `${numero(panel.viajesSinCliente)} viajes no tienen cliente asignado, así que su ingreso no aparece en ninguna fila de abajo.`}
        </p>
      )}
    </section>
  );
}

// ── Clientes ───────────────────────────────────────────────────────────────

function BloqueClientes({ panel, puedeEditar, guardarCliente }: {
  panel: PanelClientes;
  puedeEditar: boolean;
  guardarCliente: AccionForma;
}) {
  const VACIO = {
    nombre: '', rfc: '', contacto: '', correo: '', telefono: '', diasCredito: '', activo: true,
  };

  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        Clientes
      </h2>

      {panel.clientes.length === 0 ? (
        <EstadoVacio icono={<Handshake width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          Todavía no hay un solo cliente dado de alta, y por eso Likida ve lo que tu flota
          <strong> gasta</strong> pero no lo que <strong>cobra</strong>. En cuanto exista el primero y sus
          viajes lleven ingreso capturado, aquí se mide el ingreso por cliente, cuánto te deben, qué
          ya venció y qué tan concentrado está tu ingreso en una sola cuenta.
        </EstadoVacio>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left" style={{ color: 'var(--muted)' }}>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">RFC</th>
                <th className="px-3 py-2 font-medium">Crédito</th>
                <th className="px-3 py-2 font-medium text-right">Viajes</th>
                <th className="px-3 py-2 font-medium text-right">Ingreso</th>
                <th className="px-3 py-2 font-medium text-right">Por cobrar</th>
                <th className="px-3 py-2 font-medium text-right">Tarifas</th>
              </tr>
            </thead>
            <tbody>
              {panel.clientes.map((c) => (
                <RenglonCliente key={c.id} c={c} puedeEditar={puedeEditar} guardarCliente={guardarCliente} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {puedeEditar && (
        <div className="card p-4">
          <Plegable resumen="+ Dar de alta un cliente">
            <FormaCliente accion={guardarCliente} idPrefijo="alta-cliente" inicial={VACIO} />
          </Plegable>
        </div>
      )}
    </section>
  );
}

function RenglonCliente({ c, puedeEditar, guardarCliente }: {
  c: ClienteConMetricas;
  puedeEditar: boolean;
  guardarCliente: AccionForma;
}) {
  return (
    <>
      <tr className="border-t" style={{ borderColor: 'var(--line2)' }}>
        <td className="px-3 py-2">
          <span className="font-medium">{c.nombre}</span>
          {!c.activo && (
            <span className="ml-2 inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium align-middle"
              style={{ color: 'var(--muted)', background: 'var(--canvas)' }}>
              dado de baja
            </span>
          )}
        </td>
        <td className="px-3 py-2 cifra-mono" style={{ color: 'var(--muted)' }}>{c.rfc ?? '—'}</td>
        {/* NULL no es contado: la migración lo dice en el comentario de la
            columna, y suponer contado inventaría vencimientos y los pintaría
            de rojo. */}
        <td className="px-3 py-2" style={{ color: c.diasCredito === null ? 'var(--faint)' : undefined }}>
          {c.diasCredito === null ? 'sin condiciones' : `${numero(c.diasCredito)} días`}
        </td>
        <td className="px-3 py-2 text-right tabular">
          {numero(c.viajes)}
          {c.viajesSinIngreso > 0 && (
            <span className="block text-[10.5px]" style={{ color: 'var(--warn)' }}>
              {numero(c.viajesSinIngreso)} sin ingreso
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right tabular font-medium">
          {c.viajes === 0 || c.viajes === c.viajesSinIngreso
            ? <span style={{ color: 'var(--faint)' }}>sin registrar</span>
            : mxn(c.ingreso)}
        </td>
        <td className="px-3 py-2 text-right tabular">
          {c.saldoPorCobrar === null
            ? <span style={{ color: 'var(--faint)' }}>sin facturas</span>
            : (
              <>
                {mxn(c.saldoPorCobrar)}
                {c.vencido !== null && c.vencido > 0 && (
                  <span className="block text-[10.5px]" style={{ color: 'var(--bad)' }}>
                    {mxn(c.vencido)} vencido
                  </span>
                )}
              </>
            )}
        </td>
        <td className="px-3 py-2 text-right tabular" style={{ color: c.tarifas === 0 ? 'var(--faint)' : undefined }}>
          {c.tarifas === 0 ? '—' : numero(c.tarifas)}
        </td>
      </tr>
      {puedeEditar && (
        <tr style={{ borderColor: 'var(--line2)' }}>
          <td colSpan={7} className="px-3 pb-3">
            <Plegable resumen="Editar">
              <FormaCliente
                accion={guardarCliente}
                id={c.id}
                idPrefijo={`cliente-${c.id}`}
                // La fila COMPLETA, no solo lo que se ve en la tabla: el
                // guardado reemplaza el renglón entero, y un formulario que no
                // trajera contacto/correo/teléfono los borraría en silencio al
                // corregir los días de crédito.
                inicial={{
                  nombre: c.nombre,
                  rfc: c.rfc ?? '',
                  contacto: c.contacto ?? '',
                  correo: c.correo ?? '',
                  telefono: c.telefono ?? '',
                  diasCredito: c.diasCredito === null ? '' : String(c.diasCredito),
                  activo: c.activo,
                }}
              />
            </Plegable>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Tarifas ────────────────────────────────────────────────────────────────

type EstadoTarifa = 'vigente' | 'futura' | 'vencida' | 'inactiva';

/** Contra qué día se juzga: `panel.hoy`, el mismo que usó el motor para
 *  resolver las sugerencias. Comparación de strings AAAA-MM-DD, que es exacta
 *  para fechas de calendario y no se corre un día por la zona horaria. */
function estadoDe(t: TarifaRow, hoy: string): EstadoTarifa {
  if (!t.activa) return 'inactiva';
  if (t.vigenteDesde > hoy) return 'futura';
  if (t.vigenteHasta !== null && t.vigenteHasta < hoy) return 'vencida';
  return 'vigente';
}

const PILL_TARIFA: Record<EstadoTarifa, { rotulo: string; fg: string; bg: string }> = {
  vigente: { rotulo: 'vigente', fg: 'var(--ok)', bg: 'var(--okbg)' },
  futura: { rotulo: 'aún no rige', fg: 'var(--muted)', bg: 'var(--canvas)' },
  vencida: { rotulo: 'vencida', fg: 'var(--warn)', bg: 'var(--warnbg)' },
  inactiva: { rotulo: 'inactiva', fg: 'var(--muted)', bg: 'var(--canvas)' },
};

function rutaDe(t: { origen: string | null; destino: string | null }): string {
  if (t.origen && t.destino) return `${t.origen} → ${t.destino}`;
  if (t.origen) return `desde ${t.origen}`;
  if (t.destino) return `hacia ${t.destino}`;
  return 'cualquier ruta';
}

function BloqueTarifas({ panel, puedeEditar, modos, guardarTarifa }: {
  panel: PanelClientes;
  puedeEditar: boolean;
  modos: ReadonlyArray<OpcionModo>;
  guardarTarifa: AccionForma;
}) {
  const rotuloModo = (v: string) => modos.find((m) => m.valor === v)?.rotulo ?? v;
  const unidadModo = (v: string) => modos.find((m) => m.valor === v)?.unidad ?? '';
  const clientes = panel.clientes.filter((c) => c.activo).map((c) => ({ id: c.id, nombre: c.nombre }));
  const VACIA = {
    clienteId: '', origen: '', destino: '', modo: modos[0]?.valor ?? 'por_viaje',
    precio: '', moneda: 'MXN', vigenteDesde: panel.hoy, vigenteHasta: '', activa: true,
  };

  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        Tarifas
      </h2>

      {panel.tarifas.length === 0 ? (
        <EstadoVacio icono={<Route width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          No hay tarifas capturadas. Con al menos una, Likida puede decir qué precio aplica a cada
          viaje — la negociada con el cliente le gana a la de lista, y la de ruta exacta a la
          genérica. Sin catálogo no se sugiere un precio: se dice que no hay.
        </EstadoVacio>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left" style={{ color: 'var(--muted)' }}>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Ruta</th>
                <th className="px-3 py-2 font-medium">Cómo se cobra</th>
                <th className="px-3 py-2 font-medium text-right">Precio</th>
                <th className="px-3 py-2 font-medium">Vigencia</th>
                <th className="px-3 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {panel.tarifas.map((t) => (
                <RenglonTarifa
                  key={t.id} t={t} hoy={panel.hoy} puedeEditar={puedeEditar}
                  clientes={clientes} modos={modos} guardarTarifa={guardarTarifa}
                  rotuloModo={rotuloModo} unidadModo={unidadModo}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {puedeEditar && (
        <div className="card p-4">
          {panel.clientes.length === 0 ? (
            <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
              Puedes capturar tarifas de lista sin tener clientes, pero una tarifa negociada necesita
              a quién negociársela: da de alta primero al cliente.
            </p>
          ) : null}
          <Plegable resumen="+ Agregar una tarifa">
            <FormaTarifa
              accion={guardarTarifa} idPrefijo="alta-tarifa"
              clientes={clientes} modos={modos} inicial={VACIA}
            />
          </Plegable>
        </div>
      )}
    </section>
  );
}

function RenglonTarifa({
  t, hoy, puedeEditar, clientes, modos, guardarTarifa, rotuloModo, unidadModo,
}: {
  t: TarifaRow;
  hoy: string;
  puedeEditar: boolean;
  clientes: ReadonlyArray<{ id: string; nombre: string }>;
  modos: ReadonlyArray<OpcionModo>;
  guardarTarifa: AccionForma;
  rotuloModo: (v: string) => string;
  unidadModo: (v: string) => string;
}) {
  const p = PILL_TARIFA[estadoDe(t, hoy)];
  return (
    <>
      <tr className="border-t" style={{ borderColor: 'var(--line2)' }}>
        <td className="px-3 py-2">
          {t.clienteNombre ?? <span style={{ color: 'var(--faint)' }}>de lista</span>}
        </td>
        <td className="px-3 py-2">{rutaDe(t)}</td>
        <td className="px-3 py-2">{rotuloModo(t.modo)}</td>
        <td className="px-3 py-2 text-right tabular font-medium">
          {mxn(t.precio)}
          <span className="block text-[10.5px] font-normal" style={{ color: 'var(--faint)' }}>
            {unidadModo(t.modo)}
          </span>
        </td>
        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--muted)' }}>
          {fechaMx(t.vigenteDesde)} — {t.vigenteHasta ? fechaMx(t.vigenteHasta) : 'sin término'}
        </td>
        <td className="px-3 py-2">
          <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
            style={{ color: p.fg, background: p.bg }}>
            {p.rotulo}
          </span>
        </td>
      </tr>
      {puedeEditar && (
        <tr style={{ borderColor: 'var(--line2)' }}>
          <td colSpan={6} className="px-3 pb-3">
            <Plegable resumen="Editar">
              <FormaTarifa
                accion={guardarTarifa}
                id={t.id}
                idPrefijo={`tarifa-${t.id}`}
                clientes={clientes}
                modos={modos}
                inicial={{
                  clienteId: t.clienteId ?? '',
                  origen: t.origen ?? '',
                  destino: t.destino ?? '',
                  modo: t.modo,
                  precio: String(t.precio),
                  moneda: t.moneda,
                  vigenteDesde: t.vigenteDesde,
                  vigenteHasta: t.vigenteHasta ?? '',
                  activa: t.activa,
                }}
              />
            </Plegable>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Viajes sin ingreso, con la tarifa que aplicaría ────────────────────────

function BloqueSinIngreso({ panel }: { panel: PanelClientes }) {
  if (panel.sinIngresoTotal === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        Viajes sin ingreso capturado
      </h2>

      <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
        {panel.sinIngresoTotal === 1
          ? '1 viaje no tiene el ingreso del flete capturado.'
          : `${numero(panel.sinIngresoTotal)} viajes no tienen el ingreso del flete capturado.`}
        {panel.sinIngreso.length < panel.sinIngresoTotal
          && ` Se listan los ${numero(panel.sinIngreso.length)} más recientes.`}
        {' '}Mientras falte, ese viaje no entra al margen ni al ingreso por cliente.
      </p>

      <div className="card overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left" style={{ color: 'var(--muted)' }}>
              <th className="px-3 py-2 font-medium">Viaje</th>
              <th className="px-3 py-2 font-medium">Ruta</th>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 font-medium">Tarifa que aplicaría</th>
              <th className="px-3 py-2 font-medium text-right">Cotizaría</th>
            </tr>
          </thead>
          <tbody>
            {panel.sinIngreso.map((v) => (
              <RenglonSinIngreso key={v.id} v={v} />
            ))}
          </tbody>
        </table>
      </div>

      {/* La frase que evita que esta columna se lea como una medición. */}
      <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
        Esta columna dice qué precio de TU catálogo aplicaría a ese viaje — no lo que se cobró.
        Likida no captura el ingreso por ti ni lo deduce del anticipo: el anticipo es lo que le
        adelantas al operador, no lo que te paga tu cliente.
      </p>
    </section>
  );
}

function RenglonSinIngreso({ v }: { v: ViajeSinIngreso }) {
  const s = v.sugerencia;
  return (
    <tr className="border-t" style={{ borderColor: 'var(--line2)' }}>
      <td className="px-3 py-2">
        <span className="cifra-mono">{v.folio ?? '—'}</span>
        {v.fecha && (
          <span className="block text-[10.5px]" style={{ color: 'var(--faint)' }}>{fechaMx(v.fecha)}</span>
        )}
      </td>
      <td className="px-3 py-2">
        {rutaDe(v)}
        {v.km !== null && (
          <span className="block text-[10.5px] cifra-mono" style={{ color: 'var(--faint)' }}>
            {numero(v.km)} km
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        {v.clienteNombre ?? <span style={{ color: 'var(--warn)' }}>sin asignar</span>}
      </td>
      <td className="px-3 py-2">
        {s === null ? (
          <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--faint)' }}>
            <CircleDashed width={12} height={12} strokeWidth={1.75} />
            ninguna de tu catálogo aplica
          </span>
        ) : (
          <>
            {s.porque}
            {s.ambigua && (
              <span className="flex items-start gap-1 text-[10.5px] mt-0.5" style={{ color: 'var(--warn)' }}>
                <TriangleAlert width={11} height={11} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                {/* Elegir en silencio entre dos tarifas igual de aplicables es
                    cotizar a suerte: se dice y se corrige en el catálogo. */}
                hay otra tarifa igual de aplicable con distinto precio — corrige el catálogo
              </span>
            )}
          </>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular">
        {s === null ? (
          <span style={{ color: 'var(--faint)' }}>—</span>
        ) : s.monto === null ? (
          // Nunca $0.00: falta el dato, no vale cero.
          <span className="text-[11px]" style={{ color: 'var(--warn)' }}>
            {s.falta === 'km'
              ? 'faltan los km del viaje'
              : 'faltan las toneladas (Likida todavía no las guarda)'}
          </span>
        ) : (
          <span className="font-medium">{mxn(s.monto)}</span>
        )}
      </td>
    </tr>
  );
}
