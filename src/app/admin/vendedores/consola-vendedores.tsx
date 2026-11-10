import { Suspense, cache } from 'react';
import { Building2, Activity, CheckCircle2, Inbox, Users } from 'lucide-react';
import {
  ESTADOS_PROSPECTO, ESTADOS_VIVOS, TRANSICIONES_PROSPECTO,
  conteosVacios, normalizarEstadoProspecto, esEstadoVivo,
  filtrarProspectosTexto, reglaComision,
  listarProspectos, listarVendedores,
  type ProspectoRow, type VendedorRow,
} from '@/lib/likida/vendedores';
import { ultimasCorridasNegocio, duracionLegible, type CorridaRegistrada } from '@/lib/likida/agentes/corridas';
import { fechaHoraMx } from '@/lib/formato';
import { resolverFormato } from '../ui/formato-preset';
import {
  AvisoCompacto, BarraFiltros, EsqCifrasV2, EsqTablaV2, EsqTarjetaV2, EstadoVacio, FilaTarjetas, FiltroBusqueda, FiltroOpciones, Icono,
  MarcoPagina, StatusChip, Tarjeta, TablaBase, type ColumnaBase, type TonoEstado,
} from '../../ui-v2/componentes';
import { TiraCifras } from '../../ui-v2/graficas';
import { TableroProspectos, type ColumnaTablero } from './tablero';
import { FormaProspecto, FormaInvitarVendedor, BotonRepartir } from './formas';
import {
  accionMover, accionAsignar, accionNota, accionRedactar,
  accionCrearProspecto, accionInvitar, accionRepartir,
} from './acciones';
import './tablero.css';

const RUTA = '/admin/vendedores';

/** Tarjetas que se pintan por columna. El censo trae ~800 empresas: pintar cientos de tarjetas por columna cuelga el tablero, así que se
 *  recorta y el recorte SE DICE ("y N más — filtra para verlos"). */
const TOPE_COLUMNA = 30;

/** Resiliencia por sección, mismo helper que los dashboards: una consulta caída deja `null` y su tarjeta lo dice, jamás un cero con cara de dato. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/** R9c: las lecturas las pide cada bloque dentro de su <Suspense>; `cache()` las comparte entre bloques de una misma petición, así que no
 *  se lee nada dos veces ni se suma ninguna lectura nueva. */
const cargarVendedores = cache(() => safe<VendedorRow[]>(() => listarVendedores()));
const cargarProspectos = cache(() => safe<ProspectoRow[]>(() => listarProspectos()));
const cargarCorridas = cache(() => safe<CorridaRegistrada[]>(() => ultimasCorridasNegocio('ventas', 5)));

/**
 * VENTAS › VENDEDORES — el contenido completo de /admin/vendedores, SIN el gate. Vive en su propio archivo, exportado, por la razón #2 de
 * `dashboard/inicio-contenido.tsx`: la página llama `requireSuperadmin()` y un preview headless sin sesión no puede montarla; este
 * componente sí, y es el REAL (una copia verificaría la copia).
 *
 * La AUTORIZACIÓN no se relaja con la extracción: el gate de pantalla sigue en admin/layout.tsx + page.tsx, y cada server action de aquí
 * re-gatea superadmin por sesión y MFA en `acciones.ts`: montar el componente no regala ninguna escritura.
 */
export function ConsolaVendedores({ sp }: { nombre?: string | null; sp: { vendedor?: string; q?: string } }) {
  return (
    <MarcoPagina titulo="Ventas" apoyo="El pipeline del censo, el equipo de vendedores y el asignador. Las comisiones se calculan solo con cobros reales.">
      <Suspense fallback={<EsqCifrasV2 n={5} />}><BloqueKpis /></Suspense>
      <Suspense fallback={<EsqTarjetaV2 alto={320} />}><BloqueTablero sp={sp} /></Suspense>
      <FilaTarjetas variante="6-6">
        <Tarjeta titulo="Agente asignador">
          <p className="ven-tarjeta__tenue">
            Reparte los prospectos sin vendedor (en Nuevo) entre el equipo, equilibrando por carga viva. Cada corrida queda en la bitácora de agentes.
          </p>
          <BotonRepartir accion={accionRepartir} />
          <Suspense fallback={<EsqTarjetaV2 alto={60} plana />}><BloqueCorridas /></Suspense>
          {/* Lo que NO existe no se pinta como si existiera: los agentes que buscan leads y hacen el primer acercamiento son roadmap. */}
          <p className="ven-tarjeta__tenue ven-tarjeta__tenue--fino">
            Próximamente: agentes que busquen leads nuevos y hagan el primer acercamiento. No existen todavía y esta pantalla no los va a fingir.
          </p>
        </Tarjeta>
        <BloqueComisiones />
      </FilaTarjetas>
      <Suspense fallback={<EsqTablaV2 filas={4} />}><BloqueDesempeno /></Suspense>
      <Suspense fallback={<EsqTarjetaV2 alto={160} />}><BloqueAltas /></Suspense>
    </MarcoPagina>
  );
}

// ── Comisiones: solo con base real ───────────────────────────────────────────

/** La regla pactada SÍ se enseña (es un dato del negocio); el MONTO no: no hay registro de comisiones ni liga de prospecto a flota y a
 *  factura pagada, así que calcular una cifra hoy sería inventarla. Cuando exista la base, esta tarjeta se sustituye por el cálculo. */
function BloqueComisiones() {
  const regla = reglaComision();
  return (
    <Tarjeta titulo="Comisiones de vendedores" estado="vacio" mensaje="Falta: aún no hay base para calcularlas"
      detalle="Hace falta ligar cada prospecto cerrado con su flota y con la factura pagada; sin eso no se muestra ninguna cifra de comisión.">
      <p className="ven-regla"><span>{regla.primerMes}</span><span>{regla.recurrente}</span></p>
    </Tarjeta>
  );
}

// ── Bloques con su propia lectura y su propio <Suspense> (R9c) ───────────────

/** Los datos derivados del pipeline, una sola vez por bloque que los necesite (solo si las lecturas llegaron). */
async function derivarPipeline(sp: { vendedor?: string; q?: string }) {
  const [vendedores, prospectos] = await Promise.all([cargarVendedores(), cargarProspectos()]);
  const nombresVendedor = new Map((vendedores ?? []).map((v) => [v.id, v.nombre ?? v.email]));
  const opcionesVendedor = (vendedores ?? []).map((v) => ({ id: v.id, nombre: v.nombre ?? v.email }));
  const hayFiltro = Boolean(sp.vendedor || sp.q);
  let columnas: ColumnaTablero[] | null = null;
  const totales = conteosVacios();
  let vivosSinVendedor = 0;
  if (prospectos !== null) {
    for (const p of prospectos) {
      const estado = normalizarEstadoProspecto(p.estado);
      if (estado !== null) totales[estado]++;
    }
    vivosSinVendedor = prospectos.filter((p) => p.vendedorId === null && esEstadoVivo(p.estado)).length;

    const porTexto = filtrarProspectosTexto(prospectos, sp.q);
    const filtrados = sp.vendedor === 'sin'
      ? porTexto.filter((p) => p.vendedorId === null)
      : sp.vendedor
        ? porTexto.filter((p) => p.vendedorId === sp.vendedor)
        : porTexto;

    columnas = ESTADOS_PROSPECTO.map((e) => {
      // Las filas históricas se agrupan en su significado canónico; no desaparecen ni crean una segunda columna semánticamente idéntica.
      const en = filtrados.filter((p) => normalizarEstadoProspecto(p.estado) === e.valor);
      return {
        estado: e.valor,
        rotulo: e.rotulo,
        total: en.length,
        tarjetas: en.slice(0, TOPE_COLUMNA).map((p) => ({
          id: p.id,
          empresa: p.empresa,
          vacante: p.vacante,
          ciudad: p.ciudad,
          notas: p.notas,
          estado: normalizarEstadoProspecto(p.estado) ?? p.estado,
          vendedorId: p.vendedorId,
          vendedorNombre: p.vendedorId ? nombresVendedor.get(p.vendedorId) ?? null : null,
        })),
      };
    });
  }
  const vivos = ESTADOS_VIVOS.reduce((s, e) => s + totales[e], 0);
  const totalProspectos = (Object.values(totales) as number[]).reduce((s, n) => s + n, 0);
  return { vendedores, prospectos, opcionesVendedor, hayFiltro, columnas, totales, vivos, vivosSinVendedor, totalProspectos };
}

async function BloqueKpis() {
  const { vendedores, prospectos, totales, vivos, vivosSinVendedor, totalProspectos } = await derivarPipeline({});
  // Solo si el pipeline se pudo LEER: unos ceros sobre una base caída afirmarían «no hay prospectos» estando ciegos.
  if (prospectos === null) {
    return (
      <AvisoCompacto tono="error"
        resumen="No se pudo leer el pipeline en este momento. Recarga la página: esto NO significa que no haya prospectos, significa que no se pudo leer." />
    );
  }
  return (
    <TiraCifras etiqueta="Pipeline de ventas" items={[
      { etiqueta: 'Prospectos en el pipeline', valor: totalProspectos, formato: 'entero', icono: <Icono icono={Building2} /> },
      { etiqueta: 'Con seguimiento', valor: vivos, formato: 'entero', icono: <Icono icono={Activity} /> },
      { etiqueta: 'Ganados', valor: totales.won, formato: 'entero', icono: <Icono icono={CheckCircle2} /> },
      { etiqueta: 'Vivos sin vendedor', valor: vivosSinVendedor, formato: 'entero', icono: <Icono icono={Inbox} /> },
      vendedores !== null
        ? { etiqueta: 'Vendedores con cuenta', valor: vendedores.length, formato: 'entero', icono: <Icono icono={Users} /> }
        : { etiqueta: 'Vendedores con cuenta', valor: null, estado: 'error', mensaje: 'No se pudo leer el equipo de vendedores.', icono: <Icono icono={Users} /> },
    ]} />
  );
}

const TONO_CORRIDA: Record<string, TonoEstado> = { ok: 'ok', parcial: 'warn', fallo: 'bad' };

async function BloqueCorridas() {
  const corridas = await cargarCorridas();
  return (
    <div>
      <h3 className="ven-tarjeta__empresa">Últimas corridas</h3>
      {corridas === null ? (
        <p className="ven-tarjeta__tenue">No se pudo leer la bitácora del asignador.</p>
      ) : corridas.length === 0 ? (
        <p className="ven-tarjeta__tenue">El asignador aún no corre. Su primera corrida aparece aquí.</p>
      ) : (
        <ul className="ven-corridas">
          {corridas.map((c) => (
            <li key={c.id}>
              <StatusChip tono={TONO_CORRIDA[c.estado] ?? 'neutral'}>{c.estado}</StatusChip>
              <span className="ven-corridas__fecha">{fechaHoraMx(c.inicio)}</span>
              <span>{c.tareasHechas !== null && c.tareasTotal !== null ? `${c.tareasHechas}/${c.tareasTotal}` : '—'}</span>
              <span className="ven-corridas__dur">{duracionLegible(c.duracionMs) ?? ''}</span>
              {c.error && <span className="ven-corridas__error">{c.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function BloqueTablero({ sp }: { sp: { vendedor?: string; q?: string } }) {
  const { columnas, opcionesVendedor, hayFiltro, totalProspectos } = await derivarPipeline(sp);
  if (columnas === null) {
    return <Tarjeta titulo="Pipeline de prospectos" estado="error" mensaje="No se pudo leer el pipeline" reintentar />;
  }
  return (
    <Tarjeta titulo="Pipeline de prospectos" acciones={(
      /* Filtro por GET: los searchParams SON el estado del filtro, así que el link se comparte y el refresh no lo pierde. */
      <BarraFiltros accion={RUTA} enLinea buscar etiqueta="Filtrar el pipeline" limpiarHref={RUTA} nActivos={hayFiltro ? 1 : 0}>
        <FiltroOpciones nombre="vendedor" etiqueta="Vendedor" valor={sp.vendedor ?? ''}
          opciones={[{ valor: '', rotulo: 'Todos los vendedores' }, { valor: 'sin', rotulo: 'Sin asignar' }, ...opcionesVendedor.map((v) => ({ valor: v.id, rotulo: v.nombre }))]} />
        <FiltroBusqueda nombre="q" valor={sp.q ?? ''} placeholder="Empresa, vacante o ciudad" etiqueta="Buscar prospecto" maxLength={120} />
      </BarraFiltros>
    )}>
      {totalProspectos === 0 ? (
        <EstadoVacio titulo="Sin prospectos todavía" icono={Building2}>
          Agrega el primero en «Agregar prospecto», más abajo, o importa el censo: para eso existe esta zona.
        </EstadoVacio>
      ) : (
        <TableroProspectos
          columnas={columnas}
          orden={ESTADOS_PROSPECTO.map((e) => e.valor)}
          transiciones={TRANSICIONES_PROSPECTO}
          rotulos={Object.fromEntries(ESTADOS_PROSPECTO.map((e) => [e.valor, e.rotulo]))}
          vendedores={opcionesVendedor}
          mover={accionMover}
          asignar={accionAsignar}
          guardarNota={accionNota}
          redactar={accionRedactar}
          hayFiltro={hayFiltro}
        />
      )}
    </Tarjeta>
  );
}

async function BloqueDesempeno() {
  const vendedores = await cargarVendedores();
  const pct = resolverFormato('porcentaje');
  if (vendedores === null) {
    return <Tarjeta titulo="Desempeño por vendedor" estado="error" mensaje="No se pudo leer el equipo en este momento" reintentar />;
  }
  if (vendedores.length === 0) {
    return (
      <Tarjeta titulo="Desempeño por vendedor" estado="vacio" mensaje="Sin vendedores todavía"
        detalle="Invita al primero más abajo: entra con su correo y ve solo sus prospectos en /vendedor." />
    );
  }
  const columnas: ColumnaBase<VendedorRow>[] = [
    { id: 'vendedor', titulo: 'Vendedor', principal: true, celda: (v) => v.nombre ?? v.email },
    { id: 'asignados', titulo: 'Asignados', alinear: 'der', celda: (v) => v.asignados },
    ...ESTADOS_PROSPECTO.map((e): ColumnaBase<VendedorRow> => ({ id: e.valor, titulo: e.rotulo, alinear: 'der', celda: (v) => v.conteos[e.valor] })),
    // Sin cartera no hay tasa: un «0 %» pintado se leería como «lo intentó y no cerró».
    { id: 'conversion', titulo: 'Conversión', alinear: 'der', celda: (v) => (v.tasaConversion === null ? 'sin actividad todavía' : pct(v.tasaConversion * 100)) },
  ];
  // Cifras REALES de la tabla prospecto.
  return (
    <Tarjeta titulo="Desempeño por vendedor">
      <TablaBase etiqueta="Prospectos por vendedor y estado" columnas={columnas} filas={vendedores} idFila={(v) => v.id} densa tarjetaMovil className="ven-desempeno" />
    </Tarjeta>
  );
}

async function BloqueAltas() {
  const vendedores = await cargarVendedores();
  const opcionesVendedor = (vendedores ?? []).map((v) => ({ id: v.id, nombre: v.nombre ?? v.email }));
  return (
    <FilaTarjetas variante="6-6">
      <Tarjeta titulo="Agregar prospecto">
        <FormaProspecto accion={accionCrearProspecto} vendedores={opcionesVendedor} />
      </Tarjeta>
      <Tarjeta titulo="Invitar vendedor">
        <p className="ven-tarjeta__tenue">Cuenta de Likida (sin flota): entra a /vendedor y ve únicamente sus prospectos.</p>
        <FormaInvitarVendedor accion={accionInvitar} />
      </Tarjeta>
    </FilaTarjetas>
  );
}
