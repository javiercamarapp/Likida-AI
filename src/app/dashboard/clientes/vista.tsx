import {
  Handshake, Banknote, Wallet, Users, Route, TriangleAlert, CircleDashed, UserX,
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
import { CajonAlta, FormaCliente, FormaTarifa, type AccionForma, type OpcionModo } from './forma';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoTablaMaestra, CajonVistaRapida } from '@/app/ui-v2/esqueletos';
import {
  Aviso, BotonEnlace, EstadoError, EstadoVacio, Icono, StatusChip, TablaBase, Tarjeta,
  type ColumnaBase, type TonoEstado,
} from '@/app/ui-v2/componentes';
import '../caja-vacia.css';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import './clientes.css';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
import { rico } from '@/lib/i18n/rico';

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
  buscarCliente, totalClientes, sp, sufijo, camposOcultos, t = T_RESTO_ES,
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
  sp: ParamsRegistro & { qt?: string; pt?: string; editarT?: string; nuevo?: string };
  sufijo: string;
  camposOcultos: Array<[string, string]>; t?: TResto;
}) {
  const hrefNuevo = (que: 'cliente' | 'tarifa') => urlRegistro(RUTA, sufijo, { nuevo: que });
  const hrefSinNuevo = urlRegistro(RUTA, sufijo, { nuevo: null });
  // Sin un solo cliente no hay nada que medir: la tira sigue ahí (Rovaq) pero cada celda dice «—» y por qué, nunca un 0.
  const cifras = panel === null ? undefined : panel.clientes.length === 0
    ? [t('op.ingreso_de_fletes_capturado'), t('op.clientes_activos'), t('op.por_cobrar_a_clientes'), t('op.cl.k.sin_cliente')]
      .map((etiqueta): PropsCifra => ({ etiqueta, valor: null, estado: 'vacio', mensaje: t('op.sin_clientes_todavia'), matiz: 8 }))
    : cifrasDeCartera(t, panel).map((c) => ({ ...c, matiz: c.matiz ?? 8 }));
  const avisos = panel === null ? undefined : avisosDeCartera(t, panel);
  return (
    <EsqueletoTablaMaestra
      titulo={t('op.clientes')}
      apoyo={t('op.quien_paga_el_flete_y_cuanto')}
      acciones={puedeEditar && panel !== null ? (
        <>
          <BotonEnlace href={hrefNuevo('tarifa')} variante="secondary">{t('op.cl.nueva_tarifa')}</BotonEnlace>
          <BotonEnlace href={hrefNuevo('cliente')} variante="primary">{t('op.cl.nuevo_cliente')}</BotonEnlace>
        </>
      ) : undefined}
      avisos={avisos}
      cifras={cifras}
      etiquetaCifras={t('op.cl.cartera')}
      selloCifras={selloHoy(t('op.cl.cartera'))}
    >
      {panel === null ? (
        <EstadoError reintentar>{t('op.no_pude_leer_tus_clientes_tarifas')}</EstadoError>
      ) : (
        <div className="rv-cl__bloques">
          <BloqueClientes t={t} panel={panel} puedeEditar={puedeEditar} guardarCliente={guardarCliente}
            sp={sp} sufijo={sufijo} camposOcultos={camposOcultos} />
          <BloqueTarifas t={t} panel={panel} puedeEditar={puedeEditar} modos={modos} guardarTarifa={guardarTarifa}
            buscarCliente={buscarCliente} totalClientes={totalClientes}
            sp={sp} sufijo={sufijo} camposOcultos={camposOcultos} />
          <BloqueSinIngreso t={t} panel={panel} />
          {!puedeEditar && (
            <p className="rv-cl__pie">{t('op.tu_rol_ve_esta_pantalla_pero')}</p>
          )}
          {puedeEditar && sp.nuevo === 'cliente' && (
            <CajonAlta titulo={t('op.dar_de_alta_un_cliente')} hrefCerrar={hrefSinNuevo}>
              <FormaCliente accion={guardarCliente} idPrefijo="alta-cliente" inicial={{ nombre: '', rfc: '', contacto: '', correo: '', telefono: '', diasCredito: '', activo: true }} />
            </CajonAlta>
          )}
          {puedeEditar && sp.nuevo === 'tarifa' && (
            <CajonAlta titulo={t('op.agregar_una_tarifa')} hrefCerrar={hrefSinNuevo} ancho="xl">
              {panel.clientes.length === 0 ? (
                <p className="rv-cl__nota">{t('op.puedes_capturar_tarifas_de_lista_sin')}</p>
              ) : null}
              <FormaTarifa
                accion={guardarTarifa} idPrefijo="alta-tarifa"
                buscarCliente={buscarCliente} totalClientes={totalClientes}
                modos={modos}
                inicial={{
                  clienteId: '', origen: '', destino: '', modo: modos[0]?.valor ?? 'por_viaje',
                  precio: '', moneda: 'MXN', vigenteDesde: panel.hoy, vigenteHasta: '', activa: true,
                }}
              />
            </CajonAlta>
          )}
        </div>
      )}
    </EsqueletoTablaMaestra>
  );
}

// ── Las cifras y los avisos de arriba ──────────────────────────────────────

/** Cuatro cifras de la cartera. Sin un solo cliente no hay nada que medir, y cifras en cero se leen como «esta flota no cobra nada»: la tira se
 *  calla (el que llama pasa `undefined`). */
function cifrasDeCartera(t: TResto, panel: PanelClientes): PropsCifra[] {
  const activos = panel.clientes.filter((c) => c.activo).length;
  const conFacturas = panel.clientes.filter((c) => c.facturas > 0);
  const porCobrar = conFacturas.reduce((s, c) => s + (c.saldoPorCobrar ?? 0), 0);
  return [
    {
      icono: <Icono icono={Banknote} />,
      etiqueta: t('op.ingreso_de_fletes_capturado'), valor: panel.ingresoTotal, formato: 'mxn',
      nota: panel.conIngreso === 0
        ? t('op.ningun_viaje_trae_ingreso_capturado_todavia')
        : t(panel.conIngreso === 1 ? 'op.de_n_viaje_con_el_dato.uno' : 'op.de_n_viaje_con_el_dato.otros', { n: numero(panel.conIngreso) }),
      info: 'clientes.ingreso',
    },
    {
      icono: <Icono icono={Users} />,
      etiqueta: t('op.clientes_activos'), valor: activos, formato: 'numero',
      nota: panel.clientes.length !== activos
        ? t(panel.clientes.length - activos === 1 ? 'op.dado_de_baja.uno' : 'op.dado_de_baja.otros', { n: numero(panel.clientes.length - activos) })
        : undefined,
      info: 'clientes.activos',
    },
    conFacturas.length > 0
      ? {
        icono: <Icono icono={Wallet} />,
        etiqueta: t('op.por_cobrar_a_clientes'), valor: porCobrar, formato: 'mxn',
        nota: t(conFacturas.length === 1 ? 'op.de_n_cliente_con_facturas.uno' : 'op.de_n_cliente_con_facturas.otros', { n: numero(conFacturas.length) }),
        info: 'clientes.por_cobrar',
      }
      : {
        icono: <Icono icono={Wallet} />,
        etiqueta: t('op.por_cobrar'), valor: null, estado: 'vacio',
        mensaje: t('op.ninguno_de_tus_clientes_tiene_facturas'),
        info: 'clientes.por_cobrar',
      },
    {
      // Es un conteo real de `viaje.cliente_id IS NULL`: sin cliente asignado no hay margen por cliente.
      icono: <Icono icono={UserX} />,
      etiqueta: t('op.cl.k.sin_cliente'), valor: panel.viajesSinCliente, formato: 'entero',
      nota: t('op.cl.k.sin_cliente.nota'),
      ...(panel.viajesSinCliente > 0 ? { tono: 'warn' as const } : {}),
    },
  ];
}

/** A lo sumo DOS avisos (Rovaq): la concentración (siempre medida solo sobre los viajes con ingreso) y los viajes sin cliente. */
function avisosDeCartera(t: TResto, panel: PanelClientes) {
  if (panel.clientes.length === 0) return undefined;
  return (
    <>
      {panel.concentracion !== null && (
        <Aviso tono={panel.concentracion > 50 ? 'warn' : 'info'}>
          {rico(t('op.el_cliente_mas_grande_representa_el', { concentracion: panel.concentracion }), { strong: (c) => <strong>{c}</strong> })}{panel.concentracion > 50 && t('op.mas_de_la_mitad_de_lo')}{t('op.medido_solo_sobre_los_viajes_que')}
        </Aviso>
      )}
      {panel.viajesSinCliente > 0 && (
        <Aviso tono="warn">
          {panel.viajesSinCliente === 1
            ? t('op.1_viaje_no_tiene_cliente_asignado')
            : t('op.viajes_no_tienen_cliente_asignado_asi', { numero: numero(panel.viajesSinCliente) })}
        </Aviso>
      )}
    </>
  );
}

// ── Clientes ───────────────────────────────────────────────────────────────

function BloqueClientes({ panel, puedeEditar, guardarCliente, sp, sufijo, camposOcultos, t = T_RESTO_ES }: {
  panel: PanelClientes;
  puedeEditar: boolean;
  guardarCliente: AccionForma;
  sp: ParamsRegistro;
  sufijo: string;
  camposOcultos: Array<[string, string]>; t?: TResto;
}) {
  // FE-12: la tabla pintaba TODOS los clientes con su formulario de edición
  // plegado en cada fila. La búsqueda cubre nombre, RFC y contacto.
  const pagClientes = paginarRegistro(
    panel.clientes,
    (c) => [c.nombre, c.rfc, c.contacto].filter(Boolean).join(' '),
    sp,
    (c) => c.id,
  );
  const hrefEditar = (c: ClienteConMetricas) => urlRegistro(RUTA, sufijo, {
    q: pagClientes.q || null, p: pagClientes.pagina,
    editar: pagClientes.editando === c.id ? null : c.id,
  });
  const editado = pagClientes.editando ? pagClientes.filas.find((c) => c.id === pagClientes.editando) : undefined;
  const columnas: ColumnaBase<ClienteConMetricas>[] = [
    {
      id: 'cliente', titulo: t('cfg.cliente'), principal: true,
      celda: (c) => (
        <span className="rv-cl__nombre">
          {c.nombre}
          {!c.activo && <StatusChip tono="muted">{t('op.dado_de_baja')}</StatusChip>}
        </span>
      ),
    },
    { id: 'rfc', titulo: 'RFC', celda: (c) => <span className="rv-cl__mono">{c.rfc ?? '—'}</span> },
    {
      id: 'credito', titulo: t('op.credito'),
      // NULL no es contado: la migración lo dice en el comentario de la columna, y suponer contado inventaría vencimientos y los pintaría de rojo.
      celda: (c) => (c.diasCredito === null ? <span className="rv-cl__sin">{t('op.sin_condiciones')}</span> : t('op.dias', { numero: numero(c.diasCredito) })),
    },
    {
      id: 'viajes', titulo: t('op.viajes'), alinear: 'der',
      celda: (c) => (
        <>
          {numero(c.viajes)}
          {c.viajesSinIngreso > 0 && <span className="rv-cl__tenue" data-tono="warn">{numero(c.viajesSinIngreso)}{' '}{t('op.sin_ingreso')}</span>}
        </>
      ),
    },
    {
      id: 'ingreso', titulo: t('op.ingreso'), alinear: 'der',
      celda: (c) => (c.viajes === 0 || c.viajes === c.viajesSinIngreso ? <span className="rv-cl__sin">{t('op.sin_registrar')}</span> : mxn(c.ingreso)),
    },
    {
      id: 'cobrar', titulo: t('op.por_cobrar'), alinear: 'der',
      celda: (c) => (c.saldoPorCobrar === null
        ? <span className="rv-cl__sin">{t('op.sin_facturas')}</span>
        : (
          <>
            {mxn(c.saldoPorCobrar)}
            {c.vencido !== null && c.vencido > 0 && <span className="rv-cl__tenue" data-tono="bad">{mxn(c.vencido)} vencido</span>}
          </>
        )),
    },
    { id: 'tarifas', titulo: t('op.tarifas'), alinear: 'der', celda: (c) => (c.tarifas === 0 ? <span className="rv-cl__sin">—</span> : numero(c.tarifas)) },
  ];
  if (puedeEditar) {
    columnas.push({
      id: 'acciones', titulo: t('cfg.acciones'), alinear: 'der',
      celda: (c) => <BotonEnlace href={hrefEditar(c)} variante="ghost" tamano="sm">{pagClientes.editando === c.id ? 'Cerrar' : 'Editar'}</BotonEnlace>,
    });
  }

  return (
    <>
      {puedeEditar && editado && (
        <CajonVistaRapida
          titulo={t('op.cl.corregir_a', { nombre: editado.nombre })}
          subtitulo={t('op.cl.vr.cliente')}
          hrefCerrar={hrefEditar(editado)}
          cifras={[
            { etiqueta: t('op.viajes'), valor: numero(editado.viajes) },
            { etiqueta: t('op.ingreso'), valor: editado.viajes === 0 || editado.viajes === editado.viajesSinIngreso ? '—' : mxn(editado.ingreso) },
            { etiqueta: t('op.por_cobrar'), valor: editado.saldoPorCobrar === null ? '—' : mxn(editado.saldoPorCobrar) },
            { etiqueta: t('op.credito'), valor: editado.diasCredito === null ? '—' : t('op.dias', { numero: numero(editado.diasCredito) }) },
          ]}
        >
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
        </CajonVistaRapida>
      )}

      <Tarjeta titulo={t('op.clientes')} info="clientes.lista">
        {panel.clientes.length > 0 && (
          <FiltroRegistro ruta={RUTA} sufijo={sufijo} pagina={pagClientes}
            sustantivo="clientes" camposOcultos={camposOcultos} />
        )}

        {panel.clientes.length === 0 ? (
          <div className="rv-caja-vacia"><EstadoVacio icono={Handshake} contenido titulo={t('op.sin_clientes_todavia')}
            accion={puedeEditar ? <BotonEnlace href={urlRegistro(RUTA, sufijo, { nuevo: 'cliente' })} variante="primary">{t('op.cl.nuevo_cliente')}</BotonEnlace> : undefined}>{t('op.por_eso_likida_ve_lo_que')}</EstadoVacio></div>
        ) : (
          <TablaBase<ClienteConMetricas> etiqueta={t('op.clientes_y_su_rfc')} columnas={columnas} filas={pagClientes.filas}
            idFila={(c) => c.id} tarjetaMovil
            vacio={{ titulo: t('op.sin_coincidencias'), texto: t('op.ningun_cliente_coincide_con', { q: pagClientes.q }) }} />
        )}
      </Tarjeta>

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

const tonoTarifa = (t: TResto = T_RESTO_ES): Record<EstadoTarifa, { rotulo: string; tono: TonoEstado }> => ({
  vigente: { rotulo: 'vigente', tono: 'ok' },
  futura: { rotulo: t('op.aun_no_rige'), tono: 'info' },
  vencida: { rotulo: 'vencida', tono: 'warn' },
  inactiva: { rotulo: 'inactiva', tono: 'muted' },
});

function rutaDe(t: { origen: string | null; destino: string | null }): string {
  if (t.origen && t.destino) return `${t.origen} → ${t.destino}`;
  if (t.origen) return `desde ${t.origen}`;
  if (t.destino) return `hacia ${t.destino}`;
  return 'cualquier ruta';
}

function BloqueTarifas({
  panel, puedeEditar, modos, guardarTarifa, buscarCliente, totalClientes, sp, sufijo, camposOcultos, t = T_RESTO_ES,
}: {
  panel: PanelClientes;
  puedeEditar: boolean;
  modos: ReadonlyArray<OpcionModo>;
  guardarTarifa: AccionForma;
  buscarCliente: BuscarCatalogo;
  totalClientes: number | null;
  sp: ParamsRegistro & { qt?: string; pt?: string; editarT?: string; nuevo?: string };
  sufijo: string;
  camposOcultos: Array<[string, string]>; t?: TResto;
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
  const hrefEditar = (t: TarifaRow) => urlRegistro(RUTA, sufijo, {
    qt: pagTarifas.q || null, pt: pagTarifas.pagina,
    editarT: pagTarifas.editando === t.id ? null : t.id,
  });
  const editada = pagTarifas.editando ? pagTarifas.filas.find((t) => t.id === pagTarifas.editando) : undefined;
  const columnas: ColumnaBase<TarifaRow>[] = [
    { id: 'cliente', titulo: t('cfg.cliente'), principal: true, celda: (fila) => fila.clienteNombre ?? <span className="rv-cl__sin">{t('op.de_lista')}</span> },
    { id: 'ruta', titulo: t('op.ruta'), celda: (fila) => rutaDe(fila) },
    { id: 'modo', titulo: t('op.como_se_cobra'), celda: (fila) => rotuloModo(fila.modo) },
    {
      id: 'precio', titulo: t('op.precio'), alinear: 'der',
      celda: (fila) => (
        <>
          {mxn(fila.precio)}
          <span className="rv-cl__tenue">{unidadModo(fila.modo)}</span>
        </>
      ),
    },
    {
      id: 'vigencia', titulo: t('op.vigencia'),
      celda: (fila) => <span className="rv-cl__nopasa">{fechaMx(fila.vigenteDesde)} — {fila.vigenteHasta ? fechaMx(fila.vigenteHasta) : t('op.sin_termino')}</span>,
    },
    {
      id: 'estado', titulo: t('llaves.estado'),
      celda: (fila) => { const p = tonoTarifa(t)[estadoDe(fila, panel.hoy)]; return <StatusChip tono={p.tono}>{p.rotulo}</StatusChip>; },
    },
  ];
  if (puedeEditar) {
    columnas.push({
      id: 'acciones', titulo: t('cfg.acciones'), alinear: 'der',
      celda: (fila) => <BotonEnlace href={hrefEditar(fila)} variante="ghost" tamano="sm">{pagTarifas.editando === fila.id ? t('op.cerrar_2') : t('op.editar')}</BotonEnlace>,
    });
  }

  return (
    <>
      {puedeEditar && editada && (
        <CajonVistaRapida
          titulo={t('op.corregir_la_tarifa')}
          subtitulo={editada.clienteNombre ?? t('op.de_lista')}
          hrefCerrar={hrefEditar(editada)}
          cifras={[
            { etiqueta: t('op.precio'), valor: `${mxn(editada.precio)}${unidadModo(editada.modo) ? ` ${unidadModo(editada.modo)}` : ''}` },
            { etiqueta: t('op.como_se_cobra'), valor: rotuloModo(editada.modo) },
            { etiqueta: t('op.vigencia'), valor: `${fechaMx(editada.vigenteDesde)} — ${editada.vigenteHasta ? fechaMx(editada.vigenteHasta) : t('op.sin_termino')}` },
            { etiqueta: t('llaves.estado'), valor: tonoTarifa(t)[estadoDe(editada, panel.hoy)].rotulo },
          ]}
        >
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
        </CajonVistaRapida>
      )}

      <Tarjeta titulo={t('op.tarifas')} info="clientes.tarifas">
        {panel.tarifas.length > 0 && (
          <FiltroRegistro ruta={RUTA} sufijo={sufijo} pagina={pagTarifas} sustantivo="tarifas"
            camposOcultos={camposOcultos} nombreQ="qt" nombreP="pt" nombreEditar="editarT" />
        )}

        {panel.tarifas.length === 0 ? (
          <div className="rv-caja-vacia"><EstadoVacio icono={Route} contenido titulo={t('op.sin_tarifas_capturadas')}
            accion={puedeEditar ? <BotonEnlace href={urlRegistro(RUTA, sufijo, { nuevo: 'tarifa' })} variante="primary">{t('op.cl.nueva_tarifa')}</BotonEnlace> : undefined}>{t('op.con_al_menos_una_likida_puede')}</EstadoVacio></div>
        ) : (
          <TablaBase<TarifaRow> etiqueta={t('op.rutas_por_cliente')} columnas={columnas} filas={pagTarifas.filas}
            idFila={(t) => t.id} tarjetaMovil
            vacio={{ titulo: t('op.sin_coincidencias'), texto: `Ninguna tarifa coincide con «${pagTarifas.q}».` }} />
        )}
      </Tarjeta>

    </>
  );
}

// ── Viajes sin ingreso, con la tarifa que aplicaría ────────────────────────

function BloqueSinIngreso({ panel, t = T_RESTO_ES }: { panel: PanelClientes; t?: TResto }) {
  if (panel.sinIngresoTotal === 0) return null;
  const columnas: ColumnaBase<ViajeSinIngreso>[] = [
    {
      id: 'viaje', titulo: t('op.viaje'), principal: true,
      celda: (v) => (
        <>
          <span className="rv-cl__mono">{v.folio ?? '—'}</span>
          {v.fecha && <span className="rv-cl__tenue">{fechaMx(v.fecha)}</span>}
        </>
      ),
    },
    {
      id: 'ruta', titulo: t('op.ruta'),
      celda: (v) => (
        <>
          {rutaDe(v)}
          {v.km !== null && <span className="rv-cl__tenue rv-cl__mono">{numero(v.km)} km</span>}
        </>
      ),
    },
    { id: 'cliente', titulo: t('cfg.cliente'), celda: (v) => v.clienteNombre ?? <span className="rv-cl__aviso-texto">{t('op.sin_asignar')}</span> },
    { id: 'tarifa', titulo: t('op.tarifa_que_aplicaria'), celda: (v) => <TarifaSugerida t={t} v={v} /> },
    { id: 'cotizaria', titulo: t('op.cotizaria'), alinear: 'der', celda: (v) => <MontoSugerido t={t} v={v} /> },
  ];

  return (
    <Tarjeta titulo={t('op.viajes_sin_ingreso_capturado')} info="clientes.sin_ingreso">
      <p className="rv-cl__nota">
        {panel.sinIngresoTotal === 1
          ? t('op.1_viaje_no_tiene_el_ingreso')
          : t('op.viajes_no_tienen_el_ingreso_del', { numero: numero(panel.sinIngresoTotal) })}
        {panel.sinIngreso.length < panel.sinIngresoTotal
          && t('op.se_listan_los_mas_recientes', { numero: numero(panel.sinIngreso.length) })}{' '}{t('op.mientras_falte_ese_viaje_no_entra')}</p>

      <TablaBase<ViajeSinIngreso> etiqueta={t('op.viajes_por_ruta_del_cliente')} columnas={columnas} filas={panel.sinIngreso}
        idFila={(v) => v.id} tarjetaMovil />

      {/* La frase que evita que esta columna se lea como una medición. */}
      <p className="rv-cl__pie">{t('op.esta_columna_dice_que_precio_de')}</p>
    </Tarjeta>
  );
}

function TarifaSugerida({ v, t = T_RESTO_ES }: { v: ViajeSinIngreso; t?: TResto }) {
  const s = v.sugerencia;
  if (s === null) {
    return (
      <span className="rv-cl__nolugar">
        <Icono icono={CircleDashed} tam={14} />{t('op.ninguna_de_tu_catalogo_aplica')}</span>
    );
  }
  return (
    <>
      {s.porque}
      {s.ambigua && (
        <span className="rv-cl__aviso-fila">
          <Icono icono={TriangleAlert} tam={14} />{t('op.hay_otra_tarifa_igual_de_aplicable')}</span>
      )}
    </>
  );
}

function MontoSugerido({ v, t = T_RESTO_ES }: { v: ViajeSinIngreso; t?: TResto }) {
  const s = v.sugerencia;
  if (s === null) return <span className="rv-cl__sin">—</span>;
  // Nunca $0.00: falta el dato, no vale cero.
  if (s.monto === null) {
    return (
      <span className="rv-cl__tenue" data-tono="warn">
        {s.falta === 'km' ? t('op.faltan_los_km_del_viaje') : t('op.faltan_las_toneladas_likida_todavia_no')}
      </span>
    );
  }
  return <strong>{mxn(s.monto)}</strong>;
}
