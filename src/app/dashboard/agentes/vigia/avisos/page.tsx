import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { ahoraMs } from '@/lib/saludo';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { AvisoSinMigrar, crearRepoAviso, type EstadoAviso } from '@/lib/likida/vigia/aviso/repo';
import { crearRepoCambios, type FilaActual } from '@/lib/likida/vigia/aviso/cambios';
import { entregarAviso } from '@/lib/likida/vigia/aviso/entrega';
import {
  agruparPorDia, armarTarjeta, crearDepsCopia, crearRepoBandeja, DIAS_BANDEJA, MAX_TEXTO_AVISO, paraEntrega, validarDatoManual,
  type AvisoBandeja,
} from '@/lib/likida/vigia/aviso/bandeja';
import { sufijoTenant } from '../../../sufijo';
import { VistaAvisosVigia, type ResultadoAviso } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/vigia/avisos';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quien decide por los clientes: el dueño y el encargado (igual que el tablero del Vigía). El resto solo mira. */
const DECIDE = ['flota_admin', 'encargado'];
const EDITABLES: readonly EstadoAviso[] = ['pendiente_confirmacion', 'sin_destinatario', 'fallido'];

type Busqueda = { vista?: string; tenant?: string; rol?: string; pendientes?: string };

const texto = (fd: FormData, k: string): string => String(fd.get(k) ?? '');
const fallo = (error: string): ResultadoAviso => ({ ok: false, error });
const bien = (mensaje: string): ResultadoAviso => ({ ok: true, mensaje });
const CARRERA = 'Otra persona ya cambió este aviso. Recarga la pantalla para ver cómo quedó.';

/**
 * Vuelve a resolver la sesión (cookie) y devuelve el actor si su rol decide por los clientes.
 * A NIVEL DE MÓDULO a propósito (como el `actor` de ../page.tsx): una `'use server'` inline que cierra sobre una función local
 * no es serializable; aquí `sp` entra por parámetro y lo único que la acción captura son strings. El tenant sale de la
 * SESIÓN, nunca del formulario: ninguna acción lee un `tenant_id` del cliente.
 */
async function actor(sp: Busqueda) {
  const s = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(s.rol, RUTA) || !DECIDE.includes(s.rol)) return null;
  return { tenantId: s.tenantId, userId: s.userId };
}

/** Lo que cada botón hace. Cada rama vuelve a leer el aviso DE ESTA FLOTA y comprueba que su estado lo permita. */
async function ejecutar(a: { tenantId: string; userId: string }, fd: FormData): Promise<ResultadoAviso> {
  const id = texto(fd, 'id');
  if (!UUID.test(id)) return fallo('Aviso no válido.');
  const que = texto(fd, 'accion');
  const repo = crearRepoBandeja();
  const av = await repo.obtener(a.tenantId, id);
  if (!av) return fallo('No encuentro ese aviso en tu flota.');
  const ahora = new Date();
  const interno = av.datos.interno === true;

  if (que === 'confirmar') {
    if (interno || av.canal !== 'cliente_1a1' || av.estado !== 'pendiente_confirmacion') return fallo('Este aviso ya no espera tu confirmación.');
    const cfg = await crearRepoAviso().leerConfig(a.tenantId);
    if (!cfg || !cfg.habilitado) return fallo('El aviso de viaje está apagado: enciéndelo antes de confirmar.');
    if (!(await repo.aprobar(a.tenantId, id, 'pendiente_confirmacion', a.userId, ahora.toISOString()))) return fallo(CARRERA);
    return bien('Confirmado. Sale en la siguiente revisión automática (máximo 5 minutos), dentro del horario de envío y solo si el cliente autorizó mensajes por WhatsApp.');
  }

  if (que === 'copiar') {
    if (interno) return fallo('Esta es una alerta interna: no se manda al cliente.');
    if (av.estado === 'aprobado' && av.canal !== 'ejecutivo_copia') return fallo('Este aviso ya está aprobado para salir por WhatsApp directo.');
    if (!['pendiente_confirmacion', 'aprobado', 'fallido', 'sin_destinatario'].includes(av.estado)) return fallo('Este aviso ya no se puede marcar como enviado.');
    const cfg = await crearRepoAviso().leerConfig(a.tenantId);
    if (!cfg || !cfg.habilitado) return fallo('El aviso de viaje está apagado: enciéndelo antes de marcar avisos.');
    let estado = av.estado;
    if (estado === 'sin_destinatario') {
      if (!(await repo.reabrir(a.tenantId, id))) return fallo(CARRERA);
      estado = 'pendiente_confirmacion';
    }
    if (estado !== 'aprobado' && !(await repo.aprobar(a.tenantId, id, estado, a.userId, ahora.toISOString(), 'ejecutivo_copia'))) return fallo(CARRERA);
    const listo = await repo.obtener(a.tenantId, id);
    if (!listo) return fallo(CARRERA);
    const r = await entregarAviso(paraEntrega(a.tenantId, listo), crearDepsCopia(a.tenantId, cfg.habilitado, cfg.zona), 'copiar');
    if (r.estado === 'enviado') return bien('Listo: quedó marcado como enviado.');
    if (r.estado === 'omitido' && r.motivo === 'aviso_apagado') return fallo('El aviso de viaje está apagado.');
    return fallo('Otra persona está procesando este aviso. Recarga la pantalla.');
  }

  if (que === 'editar') {
    if (interno || !EDITABLES.includes(av.estado)) return fallo('Este aviso ya no se puede editar.');
    const nuevo = texto(fd, 'texto').replace(/\r\n/g, '\n').trim();
    if (nuevo === '') return fallo('El texto no puede quedar vacío.');
    if (nuevo.length > MAX_TEXTO_AVISO) return fallo(`El texto pasa de ${MAX_TEXTO_AVISO} letras: acórtalo.`);
    if (nuevo === av.texto) return fallo('No cambiaste nada del texto.');
    if (!(await repo.editarTexto(a.tenantId, av, nuevo, a.userId, ahora.toISOString()))) return fallo(CARRERA);
    return bien('Texto guardado. Revísalo y confirma cuando esté bien.');
  }

  if (que === 'descartar') {
    if (!EDITABLES.includes(av.estado) && av.estado !== 'aprobado') return fallo('Este aviso ya no se puede descartar.');
    const ok = await crearRepoCambios().cambiarEstado(a.tenantId, id, av.estado, 'descartado', 'descartado por una persona');
    return ok ? bien('Descartado: no se enviará.') : fallo(CARRERA);
  }

  if (que === 'capturar') {
    if (interno || !EDITABLES.includes(av.estado)) return fallo('Este aviso ya no admite datos nuevos.');
    const v = validarDatoManual({
      operadorNombre: texto(fd, 'operadorNombre'), licencia: texto(fd, 'licencia'), licenciaVence: texto(fd, 'licenciaVence'),
      telefono: texto(fd, 'telefono'), placasUnidad: texto(fd, 'placasUnidad'), placasCaja: texto(fd, 'placasCaja'), estadoCaja: texto(fd, 'estadoCaja'),
    });
    if (!v.ok) return fallo(v.error);
    const r = await repo.guardarDatoManual(a.tenantId, av.filaId, a.userId, v.valor);
    if (r === 'fila_ajena') return fallo('No encuentro ese servicio en tu flota.');
    return bien('Datos guardados. El aviso se rehace con ellos en la siguiente revisión automática; revísalo entonces antes de confirmar.');
  }

  return fallo('Acción no válida.');
}

/**
 * La bandeja de avisos de viaje del Vigía (Agente 4, T-A4-22): por día y por cliente, cada aviso con lo que tiene, lo que
 * falta y de dónde salió cada dato, y los botones Confirmar y enviar / Editar / Copiar y marcar enviado / Descartar.
 * Por defecto nada sale sin una persona (E5). Cero pesos. Quien solo mira no ve botones ni teléfonos completos.
 */
export default async function PaginaAvisosVigia({ searchParams }: { searchParams: Promise<Busqueda> }) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const puedeDecidir = DECIDE.includes(rol);
  const soloPendientes = sp.pendientes === '1';

  let avisoEncendido: boolean | null = null;
  let errorLectura: string | null = null;
  let sinMigrar = false;
  let avisos: AvisoBandeja[] = [];
  let filas = new Map<string, FilaActual>();
  try {
    const desde = new Date(ahoraMs() - DIAS_BANDEJA * 86_400_000).toISOString();
    const [cfg, lista] = await Promise.all([crearRepoAviso().leerConfig(tenantId), crearRepoBandeja().listar(tenantId, desde, soloPendientes)]);
    avisoEncendido = cfg ? cfg.habilitado : false;
    avisos = lista;
    const ids = [...new Set(lista.map((x) => x.filaId))];
    filas = new Map((ids.length > 0 ? await crearRepoCambios().filasPorIds(tenantId, ids) : []).map((f) => [f.id, f]));
  } catch (e) {
    if (e instanceof AvisoSinMigrar) sinMigrar = true;
    else {
      logger.error('vigia.avisos_lectura_fallo', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
      errorLectura = 'No pude leer los avisos. Intenta de nuevo en un momento.';
    }
  }

  const tarjetas = avisos.map((av) => armarTarjeta(av, filas.get(av.filaId) ?? null, !puedeDecidir));

  async function decidir(_p: ResultadoAviso, fd: FormData): Promise<ResultadoAviso> {
    'use server';
    const a = await actor(sp);
    if (!a) return fallo('Solo el dueño o el encargado de la flota decide sobre los avisos.');
    try {
      const r = await ejecutar(a, fd);
      if (r?.ok) revalidatePath(RUTA);
      return r;
    } catch (e) {
      if (e instanceof AvisoSinMigrar) return fallo('La base de datos todavía no está lista para los avisos de viaje. Avísale a soporte.');
      // Nunca el texto del aviso ni datos del operador en el log: solo el mensaje técnico.
      logger.error('vigia.aviso_accion_fallo', { tenant: a.tenantId, err: e instanceof Error ? e.message : String(e) });
      return fallo(mensajeParaPantalla(e, 'actualizar el aviso'));
    }
  }

  return (
    <VistaAvisosVigia
      sufijo={sufijoTenant(sp)}
      grupos={agruparPorDia(tarjetas)}
      total={tarjetas.length}
      soloPendientes={soloPendientes}
      puedeDecidir={puedeDecidir}
      avisoEncendido={avisoEncendido}
      errorLectura={errorLectura}
      sinMigrar={sinMigrar}
      accion={decidir}
    />
  );
}
