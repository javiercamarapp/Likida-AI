import {
  Handshake, Banknote, Wallet, Users, Route, TriangleAlert, CircleDashed,
} from 'lucide-react';
import type {
  PanelClientes, ClienteConMetricas, TarifaRow, ViajeSinIngreso,
} from '@/lib/likida/clientes';

// El formato de cifras vive SOLO en formato.ts — hay una prueba que falla si
// otro archivo formatea moneda mexicana por su cuenta.
import { mxn, numero, fechaMx } from '@/lib/formato';
import { paginarRegistro, urlRegistro, type ParamsRegistro } from '../paginar-registro';
import { FiltroRegistro } from '../registro-filtro';
import type { BuscarCatalogo } from '../combo-catalogo';
import { FormaCliente, FormaTarifa, type AccionForma, type OpcionModo } from './forma';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import {
  BotonEnlace, Disclosure, EstadoError, EstadoVacio, Icono, MarcoPagina, StatusChip, TablaBase, Tarjeta,
  type ColumnaBase, type TonoEstado,
} from '@/app/ui-v2/componentes';
import './clientes.css';

const RUTA = '/dashboard/clientes';

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
  buscarCliente, totalClientes, sp, sufijo, camposOcultos,
}: {
  panel: PanelClientes | null;
  puedeEditar: boolean;
  modos: ReadonlyArray<OpcionModo>;
  guardarCliente: AccionForma;
  guardarTarifa: AccionForma;
  /** FE-12/FE-2: el buscador de clientes del servidor, para el campo Cliente
   *  de las tarifas — antes era el catálogo COMPLETO repetido en cada forma. */
  buscarCliente: BuscarCatalogo;
  totalClientes: number | null;
  /** `?q=`/`?p=`/`?editar=` (clientes) y `?qt=`/`?pt=`/`?editarT=` (tarifas). */
  sp: ParamsRegistro & { qt?: string; pt?: string; editarT?: string };
  sufijo: string;
  camposOcultos: Array<[string, string]>;
}) {
  return (
    <MarcoPagina titulo="Clientes" apoyo="Quién paga el flete y cuánto debe, con las tarifas por cliente. No se muestra una cartera a medias.">
      {panel === null ? (
        <EstadoError reintentar>No pude leer tus clientes, tarifas y facturas. No se enseña una cartera a medias: media tabla sumada se ve igual que la tabla entera.</EstadoError>
      ) : (
        <>
          <BloqueCartera panel={panel} />
          <BloqueClientes panel={panel} puedeEditar={puedeEditar} guardarCliente={guardarCliente}
            sp={sp} sufijo={sufijo} camposOcultos={camposOcultos} />
          <BloqueTarifas panel={panel} puedeEditar={puedeEditar} modos={modos} guardarTarifa={guardarTarifa}
            buscarCliente={buscarCliente} totalClientes={totalClientes}
            sp={sp} sufijo={sufijo} camposOcultos={camposOcultos} />
          <BloqueSinIngreso panel={panel} />
          {!puedeEditar && (
            <p className="rv-cl__pie">
              Tu rol ve esta pantalla pero no da de alta clientes ni tarifas: el catálogo de precios
              es una decisión del dueño de la flota.
            </p>
          )}
        </>
      )}
    </MarcoPagina>
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
    <>
      <TiraCifras sello={selloHoy('Cartera de clientes')}>
        <Cifra
          icono={<Icono icono={Banknote} />}
          etiqueta="Ingreso de fletes capturado" valor={panel.ingresoTotal} formato="mxn"
          nota={panel.conIngreso === 0
            ? 'Ningún viaje trae ingreso capturado todavía'
            : `De ${plural(panel.conIngreso, 'viaje', 'viajes')} con el dato capturado`}
          info="clientes.ingreso"
        />
        <Cifra
          icono={<Icono icono={Users} />}
          etiqueta="Clientes activos" valor={activos} formato="numero"
          nota={panel.clientes.length !== activos
            ? `${plural(panel.clientes.length - activos, 'dado de baja', 'dados de baja')}`
            : undefined}
          info="clientes.activos"
        />
        {conFacturas.length > 0 ? (
          <Cifra
            icono={<Icono icono={Wallet} />}
            etiqueta="Por cobrar a clientes" valor={porCobrar} formato="mxn"
            nota={`De ${plural(conFacturas.length, 'cliente', 'clientes')} con facturas registradas`}
            info="clientes.por_cobrar"
          />
        ) : (
          <Cifra
            icono={<Icono icono={Wallet} />}
            etiqueta="Por cobrar" valor={null}
            mensaje="Ninguno de tus clientes tiene facturas registradas todavía, así que no hay saldo que sumar. No es cero: es que aún no se ha registrado una factura emitida."
            info="clientes.por_cobrar"
          />
        )}
      </TiraCifras>

      {panel.concentracion !== null && (
        <p className="rv-cl__nota">
          El cliente más grande representa el <strong>{panel.concentracion}%</strong> del ingreso capturado
          {panel.concentracion > 50 && ' — más de la mitad de lo que cobra tu flota depende de una sola cuenta'}.
          Medido solo sobre los viajes que traen ingreso; los que no, no entran.
        </p>
      )}

      {panel.viajesSinCliente > 0 && (
        <p className="rv-cl__nota" data-tono="warn">
          {panel.viajesSinCliente === 1
            ? '1 viaje no tiene cliente asignado, así que su ingreso no aparece en ninguna fila de abajo.'
            : `${numero(panel.viajesSinCliente)} viajes no tienen cliente asignado, así que su ingreso no aparece en ninguna fila de abajo.`}
        </p>
      )}
    </>
  );
}

// ── Clientes ───────────────────────────────────────────────────────────────

function BloqueClientes({ panel, puedeEditar, guardarCliente, sp, sufijo, camposOcultos }: {
  panel: PanelClientes;
  puedeEditar: boolean;
  guardarCliente: AccionForma;
  sp: ParamsRegistro;
  sufijo: string;
  camposOcultos: Array<[string, string]>;
}) {
  // FE-12: la tabla pintaba TODOS los clientes con su formulario de edición
  // plegado en cada fila. La búsqueda cubre nombre, RFC y contacto.
  const pagClientes = paginarRegistro(
    panel.clientes,
    (c) => [c.nombre, c.rfc, c.contacto].filter(Boolean).join(' '),
    sp,
    (c) => c.id,
  );
  const VACIO = {
    nombre: '', rfc: '', contacto: '', correo: '', telefono: '', diasCredito: '', activo: true,
  };
  const hrefEditar = (c: ClienteConMetricas) => urlRegistro(RUTA, sufijo, {
    q: pagClientes.q || null, p: pagClientes.pagina,
    editar: pagClientes.editando === c.id ? null : c.id,
  });
  const editado = pagClientes.editando ? pagClientes.filas.find((c) => c.id === pagClientes.editando) : undefined;
  const columnas: ColumnaBase<ClienteConMetricas>[] = [
    {
      id: 'cliente', titulo: 'Cliente', principal: true,
      celda: (c) => (
        <span className="rv-cl__nombre">
          {c.nombre}
          {!c.activo && <StatusChip tono="muted">dado de baja</StatusChip>}
        </span>
      ),
    },
    { id: 'rfc', titulo: 'RFC', celda: (c) => <span className="rv-cl__mono">{c.rfc ?? '—'}</span> },
    {
      id: 'credito', titulo: 'Crédito',
      // NULL no es contado: la migración lo dice en el comentario de la columna, y suponer contado inventaría vencimientos y los pintaría de rojo.
      celda: (c) => (c.diasCredito === null ? <span className="rv-cl__sin">sin condiciones</span> : `${numero(c.diasCredito)} días`),
    },
    {
      id: 'viajes', titulo: 'Viajes', alinear: 'der',
      celda: (c) => (
        <>
          {numero(c.viajes)}
          {c.viajesSinIngreso > 0 && <span className="rv-cl__tenue" data-tono="warn">{numero(c.viajesSinIngreso)} sin ingreso</span>}
        </>
      ),
    },
    {
      id: 'ingreso', titulo: 'Ingreso', alinear: 'der',
      celda: (c) => (c.viajes === 0 || c.viajes === c.viajesSinIngreso ? <span className="rv-cl__sin">sin registrar</span> : mxn(c.ingreso)),
    },
    {
      id: 'cobrar', titulo: 'Por cobrar', alinear: 'der',
      celda: (c) => (c.saldoPorCobrar === null
        ? <span className="rv-cl__sin">sin facturas</span>
        : (
          <>
            {mxn(c.saldoPorCobrar)}
            {c.vencido !== null && c.vencido > 0 && <span className="rv-cl__tenue" data-tono="bad">{mxn(c.vencido)} vencido</span>}
          </>
        )),
    },
    { id: 'tarifas', titulo: 'Tarifas', alinear: 'der', celda: (c) => (c.tarifas === 0 ? <span className="rv-cl__sin">—</span> : numero(c.tarifas)) },
  ];
  if (puedeEditar) {
    columnas.push({
      id: 'acciones', titulo: 'Acciones', alinear: 'der',
      celda: (c) => <BotonEnlace href={hrefEditar(c)} variante="ghost" tamano="sm">{pagClientes.editando === c.id ? 'Cerrar' : 'Editar'}</BotonEnlace>,
    });
  }

  return (
    <>
      {puedeEditar && editado && (
        <Tarjeta titulo={`Corregir a ${editado.nombre}`}>
          <div className="rv-cl__editor">
            <FormaCliente
              accion={guardarCliente}
              id={editado.id}
              idPrefijo={`cliente-${editado.id}`}
              // La fila COMPLETA, no solo lo que se ve en la tabla: el guardado reemplaza el renglón entero, y un formulario que no
              // trajera contacto/correo/teléfono los borraría en silencio al corregir los días de crédito.
              inicial={{
                nombre: editado.nombre,
                rfc: editado.rfc ?? '',
                contacto: editado.contacto ?? '',
                correo: editado.correo ?? '',
                telefono: editado.telefono ?? '',
                diasCredito: editado.diasCredito === null ? '' : String(editado.diasCredito),
                activo: editado.activo,
              }}
            />
            <BotonEnlace href={hrefEditar(editado)} variante="ghost" tamano="sm">Cerrar</BotonEnlace>
          </div>
        </Tarjeta>
      )}

      <Tarjeta titulo="Clientes" info="clientes.lista">
        {panel.clientes.length > 0 && (
          <FiltroRegistro ruta={RUTA} sufijo={sufijo} pagina={pagClientes}
            sustantivo="clientes" camposOcultos={camposOcultos} />
        )}

        {panel.clientes.length === 0 ? (
          <EstadoVacio icono={Handshake} contenido titulo="Sin clientes todavía">
            Por eso Likida ve lo que tu flota gasta pero no lo que cobra. Con el primero y sus
            viajes con ingreso capturado, aquí se mide el ingreso por cliente, cuánto te deben, qué
            ya venció y qué tan concentrado está tu ingreso en una sola cuenta.
          </EstadoVacio>
        ) : (
          <TablaBase<ClienteConMetricas> etiqueta="Clientes y su RFC" columnas={columnas} filas={pagClientes.filas}
            idFila={(c) => c.id} tarjetaMovil
            vacio={{ titulo: 'Sin coincidencias', texto: `Ningún cliente coincide con «${pagClientes.q}».` }} />
        )}
      </Tarjeta>

      {puedeEditar && (
        <Disclosure variante="tarjeta" titulo="Dar de alta un cliente">
          <FormaCliente accion={guardarCliente} idPrefijo="alta-cliente" inicial={VACIO} />
        </Disclosure>
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

const TONO_TARIFA: Record<EstadoTarifa, { rotulo: string; tono: TonoEstado }> = {
  vigente: { rotulo: 'vigente', tono: 'ok' },
  futura: { rotulo: 'aún no rige', tono: 'info' },
  vencida: { rotulo: 'vencida', tono: 'warn' },
  inactiva: { rotulo: 'inactiva', tono: 'muted' },
};

function rutaDe(t: { origen: string | null; destino: string | null }): string {
  if (t.origen && t.destino) return `${t.origen} → ${t.destino}`;
  if (t.origen) return `desde ${t.origen}`;
  if (t.destino) return `hacia ${t.destino}`;
  return 'cualquier ruta';
}

function BloqueTarifas({
  panel, puedeEditar, modos, guardarTarifa, buscarCliente, totalClientes, sp, sufijo, camposOcultos,
}: {
  panel: PanelClientes;
  puedeEditar: boolean;
  modos: ReadonlyArray<OpcionModo>;
  guardarTarifa: AccionForma;
  buscarCliente: BuscarCatalogo;
  totalClientes: number | null;
  sp: ParamsRegistro & { qt?: string; pt?: string; editarT?: string };
  sufijo: string;
  camposOcultos: Array<[string, string]>;
}) {
  const rotuloModo = (v: string) => modos.find((m) => m.valor === v)?.rotulo ?? v;
  const unidadModo = (v: string) => modos.find((m) => m.valor === v)?.unidad ?? '';
  // FE-12: las tarifas tienen sus PROPIOS parámetros (`qt`/`pt`/`editarT`)
  // para que buscar una tarifa no mueva la tabla de clientes de la misma
  // pantalla — dos registros en una página son dos registros.
  const pagTarifas = paginarRegistro(
    panel.tarifas,
    (t) => [t.clienteNombre, t.origen, t.destino, rotuloModo(t.modo)].filter(Boolean).join(' '),
    { q: sp.qt, p: sp.pt, editar: sp.editarT },
    (t) => t.id,
  );
  const VACIA = {
    clienteId: '', origen: '', destino: '', modo: modos[0]?.valor ?? 'por_viaje',
    precio: '', moneda: 'MXN', vigenteDesde: panel.hoy, vigenteHasta: '', activa: true,
  };
  const hrefEditar = (t: TarifaRow) => urlRegistro(RUTA, sufijo, {
    qt: pagTarifas.q || null, pt: pagTarifas.pagina,
    editarT: pagTarifas.editando === t.id ? null : t.id,
  });
  const editada = pagTarifas.editando ? pagTarifas.filas.find((t) => t.id === pagTarifas.editando) : undefined;
  const columnas: ColumnaBase<TarifaRow>[] = [
    { id: 'cliente', titulo: 'Cliente', principal: true, celda: (t) => t.clienteNombre ?? <span className="rv-cl__sin">de lista</span> },
    { id: 'ruta', titulo: 'Ruta', celda: (t) => rutaDe(t) },
    { id: 'modo', titulo: 'Cómo se cobra', celda: (t) => rotuloModo(t.modo) },
    {
      id: 'precio', titulo: 'Precio', alinear: 'der',
      celda: (t) => (
        <>
          {mxn(t.precio)}
          <span className="rv-cl__tenue">{unidadModo(t.modo)}</span>
        </>
      ),
    },
    {
      id: 'vigencia', titulo: 'Vigencia',
      celda: (t) => <span className="rv-cl__nopasa">{fechaMx(t.vigenteDesde)} — {t.vigenteHasta ? fechaMx(t.vigenteHasta) : 'sin término'}</span>,
    },
    {
      id: 'estado', titulo: 'Estado',
      celda: (t) => { const p = TONO_TARIFA[estadoDe(t, panel.hoy)]; return <StatusChip tono={p.tono}>{p.rotulo}</StatusChip>; },
    },
  ];
  if (puedeEditar) {
    columnas.push({
      id: 'acciones', titulo: 'Acciones', alinear: 'der',
      celda: (t) => <BotonEnlace href={hrefEditar(t)} variante="ghost" tamano="sm">{pagTarifas.editando === t.id ? 'Cerrar' : 'Editar'}</BotonEnlace>,
    });
  }

  return (
    <>
      {puedeEditar && editada && (
        <Tarjeta titulo="Corregir la tarifa">
          <div className="rv-cl__editor">
            <FormaTarifa
              accion={guardarTarifa}
              id={editada.id}
              idPrefijo={`tarifa-${editada.id}`}
              clienteNombre={editada.clienteNombre ?? ''}
              buscarCliente={buscarCliente}
              totalClientes={totalClientes}
              modos={modos}
              inicial={{
                clienteId: editada.clienteId ?? '',
                origen: editada.origen ?? '',
                destino: editada.destino ?? '',
                modo: editada.modo,
                precio: String(editada.precio),
                moneda: editada.moneda,
                vigenteDesde: editada.vigenteDesde,
                vigenteHasta: editada.vigenteHasta ?? '',
                activa: editada.activa,
              }}
            />
            <BotonEnlace href={hrefEditar(editada)} variante="ghost" tamano="sm">Cerrar</BotonEnlace>
          </div>
        </Tarjeta>
      )}

      <Tarjeta titulo="Tarifas" info="clientes.tarifas">
        {panel.tarifas.length > 0 && (
          <FiltroRegistro ruta={RUTA} sufijo={sufijo} pagina={pagTarifas} sustantivo="tarifas"
            camposOcultos={camposOcultos} nombreQ="qt" nombreP="pt" nombreEditar="editarT" />
        )}

        {panel.tarifas.length === 0 ? (
          <EstadoVacio icono={Route} contenido titulo="Sin tarifas capturadas">
            Con al menos una, Likida puede decir qué precio aplica a cada viaje: la negociada con el cliente le gana a la de lista, y la
            de ruta exacta a la genérica. Sin catálogo no se sugiere un precio: se dice que no hay.
          </EstadoVacio>
        ) : (
          <TablaBase<TarifaRow> etiqueta="Rutas por cliente" columnas={columnas} filas={pagTarifas.filas}
            idFila={(t) => t.id} tarjetaMovil
            vacio={{ titulo: 'Sin coincidencias', texto: `Ninguna tarifa coincide con «${pagTarifas.q}».` }} />
        )}
      </Tarjeta>

      {puedeEditar && (
        <Disclosure variante="tarjeta" titulo="Agregar una tarifa">
          {panel.clientes.length === 0 ? (
            <p className="rv-cl__nota">
              Puedes capturar tarifas de lista sin tener clientes, pero una tarifa negociada necesita
              a quién negociársela: da de alta primero al cliente.
            </p>
          ) : null}
          <FormaTarifa
            accion={guardarTarifa} idPrefijo="alta-tarifa"
            buscarCliente={buscarCliente} totalClientes={totalClientes}
            modos={modos} inicial={VACIA}
          />
        </Disclosure>
      )}
    </>
  );
}

// ── Viajes sin ingreso, con la tarifa que aplicaría ────────────────────────

function BloqueSinIngreso({ panel }: { panel: PanelClientes }) {
  if (panel.sinIngresoTotal === 0) return null;
  const columnas: ColumnaBase<ViajeSinIngreso>[] = [
    {
      id: 'viaje', titulo: 'Viaje', principal: true,
      celda: (v) => (
        <>
          <span className="rv-cl__mono">{v.folio ?? '—'}</span>
          {v.fecha && <span className="rv-cl__tenue">{fechaMx(v.fecha)}</span>}
        </>
      ),
    },
    {
      id: 'ruta', titulo: 'Ruta',
      celda: (v) => (
        <>
          {rutaDe(v)}
          {v.km !== null && <span className="rv-cl__tenue rv-cl__mono">{numero(v.km)} km</span>}
        </>
      ),
    },
    { id: 'cliente', titulo: 'Cliente', celda: (v) => v.clienteNombre ?? <span className="rv-cl__aviso-texto">sin asignar</span> },
    { id: 'tarifa', titulo: 'Tarifa que aplicaría', celda: (v) => <TarifaSugerida v={v} /> },
    { id: 'cotizaria', titulo: 'Cotizaría', alinear: 'der', celda: (v) => <MontoSugerido v={v} /> },
  ];

  return (
    <Tarjeta titulo="Viajes sin ingreso capturado" info="clientes.sin_ingreso">
      <p className="rv-cl__nota">
        {panel.sinIngresoTotal === 1
          ? '1 viaje no tiene el ingreso del flete capturado.'
          : `${numero(panel.sinIngresoTotal)} viajes no tienen el ingreso del flete capturado.`}
        {panel.sinIngreso.length < panel.sinIngresoTotal
          && ` Se listan los ${numero(panel.sinIngreso.length)} más recientes.`}
        {' '}Mientras falte, ese viaje no entra al margen ni al ingreso por cliente.
      </p>

      <TablaBase<ViajeSinIngreso> etiqueta="Viajes por ruta del cliente" columnas={columnas} filas={panel.sinIngreso}
        idFila={(v) => v.id} tarjetaMovil />

      {/* La frase que evita que esta columna se lea como una medición. */}
      <p className="rv-cl__pie">
        Esta columna dice qué precio de TU catálogo aplicaría a ese viaje — no lo que se cobró.
        Likida no captura el ingreso por ti ni lo deduce del anticipo: el anticipo es lo que le
        adelantas al operador, no lo que te paga tu cliente.
      </p>
    </Tarjeta>
  );
}

function TarifaSugerida({ v }: { v: ViajeSinIngreso }) {
  const s = v.sugerencia;
  if (s === null) {
    return (
      <span className="rv-cl__nolugar">
        <Icono icono={CircleDashed} tam={14} />
        ninguna de tu catálogo aplica
      </span>
    );
  }
  return (
    <>
      {s.porque}
      {s.ambigua && (
        <span className="rv-cl__aviso-fila">
          <Icono icono={TriangleAlert} tam={14} />
          {/* Elegir en silencio entre dos tarifas igual de aplicables es cotizar a suerte: se dice y se corrige en el catálogo. */}
          hay otra tarifa igual de aplicable con distinto precio — corrige el catálogo
        </span>
      )}
    </>
  );
}

function MontoSugerido({ v }: { v: ViajeSinIngreso }) {
  const s = v.sugerencia;
  if (s === null) return <span className="rv-cl__sin">—</span>;
  // Nunca $0.00: falta el dato, no vale cero.
  if (s.monto === null) {
    return (
      <span className="rv-cl__tenue" data-tono="warn">
        {s.falta === 'km' ? 'faltan los km del viaje' : 'faltan las toneladas (Likida todavía no las guarda)'}
      </span>
    );
  }
  return <strong>{mxn(s.monto)}</strong>;
}
