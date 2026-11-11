import { revalidatePath } from 'next/cache';
import { BadgePercent, Inbox } from 'lucide-react';
import { getT } from '@/lib/i18n/servidor';
import { getSessionTenant } from '@/lib/auth/session';
import { veredictoMfaDeSesion } from '@/lib/auth/superadmin-mfa';
import { MSG_MFA_SUPERADMIN } from '@/lib/auth/mfa';
import {
  ESTADOS_PROSPECTO, ESTADOS_VIVOS, TRANSICIONES_PROSPECTO,
  conteosVacios, normalizarEstadoProspecto, reglaComision,
  listarProspectos, listarVendedores, cambiarEstadoProspecto, actualizarNotasProspecto,
  type ProspectoRow, type VendedorRow,
} from '@/lib/likida/vendedores';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { anotarAccionVendedor, type AccionRegistrada } from '@/lib/likida/vendedores_registro';
import { Tarjeta, Icono, Aviso } from '../ui-v2/componentes';
import { EsqueletoPortada } from '../ui-v2/esqueletos';
import { TableroProspectos, type ColumnaTablero, type ResultadoAccion } from '../admin/vendedores/tablero';

const RUTA = '/vendedor';

/**
 * El mismo tope que el tablero del admin — el recorte siempre se dice.
 *
 * FE-10 (22-ago-2026): el recorte se decía con "y N más — filtra para verlos"
 * en una pantalla que NO TIENE filtro. Con una cartera de 200 prospectos, 170
 * quedaban invisibles y el único consejo era usar un control inexistente.
 * Ahora cada columna recortada lleva `?col=<estado>&pag=N`: se expande ESA
 * columna, de `TOPE_COLUMNA` en `TOPE_COLUMNA`, con su link de vuelta.
 */
const TOPE_COLUMNA = 30;

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * El ancla de TODA escritura de este panel: el rol se re-comprueba y, para
 * un vendedor, cada UPDATE va clavado a SU userId de SESIÓN — jamás a uno
 * del formulario NI al prop del componente (el prop solo decide qué se LEE;
 * la escritura siempre re-resuelve la sesión, así que montar el componente
 * en un preview no regala ninguna escritura). Un prospecto ajeno
 * simplemente "no existe" para él (`soloDeVendedor` en vendedores.ts). El
 * superadmin (soporte) opera sin ancla, con su cinta puesta.
 */
export async function ejecutarComoVendedor(
  hacer: (ancla: { soloDeVendedor?: string }) => Promise<void>,
  operacion: string,
  /** Qué dejar en la bitácora cuando la acción salga bien (ids y etapas; nunca texto libre). */
  registro?: { accion: AccionRegistrada; entidadId: string; detalle: Record<string, unknown> },
): Promise<ResultadoAccion> {
  const s = await getSessionTenant();
  if (!s || (s.rol !== 'vendedor' && s.rol !== 'superadmin')) {
    return { ok: false, error: 'Tu sesión no puede tocar prospectos.' };
  }
  const veredictoMfa = await veredictoMfaDeSesion(s);
  if (veredictoMfa !== 'ok') {
    return { ok: false, error: MSG_MFA_SUPERADMIN[veredictoMfa] };
  }
  try {
    await hacer(s.rol === 'vendedor' ? { soloDeVendedor: s.userId } : {});
    if (registro) await anotarAccionVendedor({ userId: s.userId, rol: s.rol }, registro.accion, registro.entidadId, registro.detalle);
    revalidatePath(RUTA);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mensajeParaPantalla(e, operacion) };
  }
}

/**
 * EL PANEL DEL VENDEDOR — el contenido completo de /vendedor, SIN el gate.
 * Vive en su propio archivo, exportado, por la razón #2 de
 * `dashboard/inicio-contenido.tsx`: el gate (`requireVendedor`) vive en el
 * layout y la página, y un preview headless sin sesión no puede montarlos —
 * este componente sí se monta con un `userId` arbitrario, y es el REAL.
 *
 * `userId`/`rol` vienen de la SESIÓN cuando lo monta la página real; solo
 * deciden qué se LEE. Las escrituras re-resuelven la sesión por su cuenta
 * (`ejecutarComoVendedor`), así que un preview montado con cualquier id
 * puede pintar, pero no escribir.
 */
export async function PanelVendedor({
  userId, rol, col, pag,
}: {
  userId: string;
  /** Lo manda la página; el nombre ya vive en la cabecera. */
  nombre?: string | null;
  rol: string;
  /** FE-10: qué columna está EXPANDIDA (`?col=<estado>`). Un valor fuera del
   *  dominio se ignora — un link viejo o manipulado se lee como "ninguna". */
  col?: string;
  /** Qué página de esa columna (`?pag=1` es la primera). */
  pag?: string;
}) {
  const esVendedor = rol === 'vendedor';

  // El vendedor ve SU cartera (filtro por el userId de SESIÓN, en SQL); el
  // superadmin ve todo y además resuelve nombres para las tarjetas.
  const [prospectos, equipo] = await Promise.all([
    safe<ProspectoRow[]>(() => listarProspectos(esVendedor ? { vendedorId: userId } : {})),
    esVendedor ? Promise.resolve(null) : safe<VendedorRow[]>(() => listarVendedores()),
  ]);
  const nombresVendedor = new Map((equipo ?? []).map((v) => [v.id, v.nombre ?? v.email]));

  async function accionMover(id: string, a: string): Promise<ResultadoAccion> {
    'use server';
    return ejecutarComoVendedor(
      (ancla) => cambiarEstadoProspecto(String(id), String(a), ancla),
      'mover el prospecto',
      { accion: 'prospecto.movido', entidadId: String(id), detalle: { a: String(a) } },
    );
  }

  async function accionNota(id: string, nota: string): Promise<ResultadoAccion> {
    'use server';
    return ejecutarComoVendedor(
      (ancla) => actualizarNotasProspecto(String(id), String(nota), ancla),
      'guardar la nota',
      // Solo el largo: el texto de la nota es del vendedor y la bitácora sobrevive a un borrado ARCO.
      { accion: 'prospecto.nota', entidadId: String(id), detalle: { largo: String(nota).length } },
    );
  }

  // FE-10: la columna expandida y su página. Ambas se SANEAN: `col` tiene que
  // ser un estado del dominio y `pag` un entero ≥ 1; cualquier otra cosa se
  // lee como "ninguna columna expandida, primera página".
  const expandida = ESTADOS_PROSPECTO.some((e) => e.valor === col) ? col : null;
  const paginaCruda = Number(pag);
  const pagina = Number.isInteger(paginaCruda) && paginaCruda >= 1 ? paginaCruda : 1;

  const totales = conteosVacios();
  let columnas: ColumnaTablero[] | null = null;
  if (prospectos !== null) {
    for (const p of prospectos) {
      const estado = normalizarEstadoProspecto(p.estado);
      if (estado !== null) totales[estado]++;
    }
    columnas = ESTADOS_PROSPECTO.map((e) => {
      const en = prospectos.filter((p) => normalizarEstadoProspecto(p.estado) === e.valor);
      // Solo la columna expandida pagina; las demás enseñan su primer tramo.
      const esta = e.valor === expandida;
      const desde = esta ? (pagina - 1) * TOPE_COLUMNA : 0;
      const hasta = desde + TOPE_COLUMNA;
      const restantes = Math.max(0, en.length - hasta);
      return {
        estado: e.valor,
        rotulo: e.rotulo,
        total: en.length,
        // El link SIEMPRE dice cuántos faltan de verdad — nunca "ver más" a
        // secas sobre una columna que ya no tiene más.
        mas: restantes > 0
          ? {
            href: `${RUTA}?col=${e.valor}&pag=${esta ? pagina + 1 : 2}`,
            etiqueta: `${restantes} más en esta etapa — ver ${Math.min(TOPE_COLUMNA, restantes)} más`,
          }
          : null,
        menos: esta && pagina > 1
          ? {
            href: pagina === 2 ? RUTA : `${RUTA}?col=${e.valor}&pag=${pagina - 1}`,
            etiqueta: 'Ver los anteriores',
          }
          : null,
        tarjetas: en.slice(desde, hasta).map((p) => ({
          id: p.id,
          empresa: p.empresa,
          vacante: p.vacante,
          ciudad: p.ciudad,
          notas: p.notas,
          estado: normalizarEstadoProspecto(p.estado) ?? p.estado,
          vendedorId: p.vendedorId,
          // En SU panel el dueño de cada tarjeta es él (la línea de vendedor
          // ni se pinta — `conVendedor` abajo); al superadmin sí le sirve.
          vendedorNombre: p.vendedorId ? nombresVendedor.get(p.vendedorId) ?? null : null,
        })),
      };
    });
  }
  const vivos = ESTADOS_VIVOS.reduce((sum, e) => sum + totales[e], 0);
  const comision = reglaComision();

  const { t: tv } = await getT('resto');
  const cifras = prospectos === null ? undefined : [
    // Sin icono en el rótulo (la celda ya lleva su punto de procedencia): solo rótulo, cifra y una nota que dice qué cuenta.
    { etiqueta: esVendedor ? 'Mi cartera viva' : 'Cartera viva (todos)', valor: vivos, formato: 'entero' as const, nota: tv('e26b.vend_vivos_nota') },
    { etiqueta: esVendedor ? 'Mis ganados' : 'Ganados (todos)', valor: totales.won, formato: 'entero' as const, nota: tv('e26b.vend_ganados_nota') },
    { etiqueta: 'Propuesta o piloto', valor: totales.proposal + totales.pilot, formato: 'entero' as const, nota: tv('e26b.vend_propuesta_nota') },
  ];

  return (
    <EsqueletoPortada
      area={tv('r4.vend_area')} apoyo={tv('r4.vend_apoyo')}
      titulo={esVendedor ? 'Mis prospectos' : 'Prospectos (soporte)'}
      cifras={cifras} etiquetaCifras={esVendedor ? 'Mi cartera' : 'Cartera (todos)'}
    >
      {prospectos === null ? (
        <Aviso tono="error">
          No se pudieron cargar tus prospectos en este momento. Recarga la página — esto NO
          significa que no tengas: significa que no se pudo leer.
        </Aviso>
      ) : (
        <>
          {/* La regla de comisión, con su aclaración pegada: 50/20 es la regla pactada; el dinero sale de cobros reales, hoy $0. */}
          <Tarjeta titulo="Tu comisión">
            <div className="vnd-comision">
              <Icono icono={BadgePercent} tam={16} />
              <div>
                <p className="vnd-comision__regla">{comision.primerMes}</p>
                <p className="vnd-comision__regla">{comision.recurrente}</p>
                <p className="vnd-comision__nota">
                  Falta el cálculo: aún no hay registro de comisiones ni la liga de cada prospecto cerrado con su flota y su factura pagada, así que no se muestra ninguna cifra.
                </p>
              </div>
            </div>
          </Tarjeta>

          <Tarjeta titulo={esVendedor ? 'Tu tablero' : 'El tablero completo'}
            estado={prospectos.length === 0 ? 'vacio' : 'ok'}
            mensaje="Sin prospectos asignados"
            detalle="En cuanto te asignen los primeros (a mano o con el asignador), aparecen aquí con la empresa y la vacante que publicó."
            iconoVacio={Inbox}>
            {columnas !== null && (
              <TableroProspectos
                columnas={columnas}
                orden={ESTADOS_PROSPECTO.map((e) => e.valor)}
                transiciones={TRANSICIONES_PROSPECTO}
                rotulos={Object.fromEntries(ESTADOS_PROSPECTO.map((e) => [e.valor, e.rotulo]))}
                vendedores={[]}
                mover={accionMover}
                guardarNota={accionNota}
                conVendedor={!esVendedor}
              />
            )}
          </Tarjeta>
        </>
      )}
    </EsqueletoPortada>
  );
}
