import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from './presupuesto';
import { getFiscalDeFlota } from './facturacion/flota_fiscal';
import { portalesVivos, PORTALES_CONOCIDOS } from './facturacion/adaptadores/registro';
import { modoEfectivo, mandatoFiscalAceptado } from './facturacion/modo';
import { correoConfigurado } from '@/lib/correo/enviar';
import { CONECTORES_GPS } from './conectores/gps';
import { lectorDe } from './conectores/posiciones';

// ═══════════════════════════════════════════════════════════════════════════
// CONEXIONES (F7 del plan — el chasis de agentes): qué tiene conectado la
// flota y qué le falta, con estado MEDIDO — nunca un semáforo decorativo.
// La regla de la pantalla: cada renglón dice de dónde salió su verdad, y lo
// que no se puede medir se declara 'no_medible' en vez de pintarse verde.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cuántas credenciales de GPS tiene ACTIVAS esta flota, para la sección de
 * Integraciones que ahora vive en la misma pantalla (fusión de agosto-2026).
 *
 * `null` = no se pudo leer, que NO es cero: `catalogoIntegraciones` lo trata
 * como «falta conectar» y nunca como conectado. Se cuenta en
 * `conector_credencial` y no en `rastreo_credencial` por la misma razón que el
 * renglón de arriba: es donde la pantalla escribe y donde el motor lee.
 */
export async function contarCredencialesGps(tenantId: string): Promise<number | null> {
  try {
    const { count, error } = await acotada(supabaseAdmin()
      .from('conector_credencial')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('activo', true)
      .in('conector_id', IDS_GPS), 'conexiones.integraciones.gps');
    return error ? null : count ?? 0;
  } catch {
    // Los dos caminos de falla —el `error` de PostgREST y la excepción de
    // red— aplastados a 0 dirían «sin conectar» cuando la verdad es «no sé».
    return null;
  }
}

/**
 * LAS TRES COSAS QUE HACEN FALTA PARA QUE EL GPS ENTRE, medidas por separado.
 *
 * La cadena completa es: credencial capturada → unidad ligada a su dispositivo
 * → el cron trae posiciones. Medir solo la primera es lo que hacía el renglón
 * viejo, y por eso podía decir «conectado» con el mapa vacío. Cada pieza cae
 * por su lado con `null` = «no se pudo leer», que NO es cero: afirmar «no
 * tienes GPS» con la base caída manda a recapturar lo que ya existe.
 */
async function medirRastreo(tenantId: string): Promise<SenalesRastreo> {
  const [cred, ligadas, vistas] = await Promise.all([
    acotada(supabaseAdmin()
      .from('conector_credencial')
      .select('conector_id')
      .eq('tenant_id', tenantId)
      .eq('activo', true)
      .in('conector_id', IDS_GPS), 'conexiones.rastreo.credenciales')
      .then(({ data, error }) => (error ? null : (data ?? []).map((f) => String(f.conector_id)))),
    acotada(supabaseAdmin()
      .from('unidad')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .not('gps_device_id', 'is', null), 'conexiones.rastreo.ligadas')
      .then(({ count, error }) => (error ? null : count ?? 0)),
    acotada(supabaseAdmin()
      .from('unidad')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .not('gps_visto_en', 'is', null), 'conexiones.rastreo.vistas')
      .then(({ count, error }) => (error ? null : count ?? 0)),
  ]);
  return { conectores: cred as string[] | null, ligadas: ligadas as number | null, vistas: vistas as number | null };
}

/**
 * El renglón de rastreo, armado desde lo medido.
 *
 * Los cuatro casos que distingue, y por qué cada uno importa:
 *   · no se pudo leer  → se dice. No es «sin conectar».
 *   · sin credencial   → se dice QUÉ falta y DÓNDE se captura (abajo, en esta
 *                        misma pantalla).
 *   · con credencial y sin posiciones → INCOMPLETO, con el eslabón que falta
 *                        nombrado: o ninguna unidad tiene dispositivo ligado, o
 *                        el proveedor capturado todavía no tiene lector escrito,
 *                        o el cron aún no ha corrido.
 *   · con posiciones   → LISTO, y es lo único que se puede llamar así: hay una
 *                        lectura real de un proveedor asentada en una unidad.
 *
 * PURA y exportada para poder probar los cuatro sin base (mismo criterio que
 * `catalogoIntegraciones`).
 */
export function renglonRastreo(s: SenalesRastreo): Conector {
  const base = { id: 'rastreo' as const, nombre: 'Rastreo GPS (credenciales del proveedor)' };

  if (s.conectores === null) {
    // AUDITORÍA CICLO 7, c7-28: esto devolvía `'sin_configurar'`, y la píldora
    // decía **«Sin conectar»** —el mismo rótulo y el mismo color gris que una
    // flota que nunca capturó un GPS— cuando la verdad era que la consulta no
    // contestó. La cabecera de este módulo prometía `'no_medible'` desde el
    // primer día y ese estado NO EXISTÍA en la unión: la promesa estaba en un
    // comentario y no en el código. Afirmar «no tienes GPS» con la base caída
    // es lo que manda a un contralor a recapturar una credencial que ya existe,
    // que es exactamente el fallo que #143 dijo haber cerrado un escalón más
    // abajo.
    return {
      ...base,
      estado: 'no_medible',
      detalle: 'NO SE PUDO LEER el estado del rastreo ahora mismo — la consulta a la base no contestó. Esto NO dice que no tengas GPS conectado: dice que en este momento no se puede saber. Vuelve a cargar la pantalla en un minuto.',
      falta: [],
    };
  }

  if (s.conectores.length === 0) {
    return {
      ...base,
      estado: 'sin_configurar',
      detalle: 'Sin conectar — el mapa pinta trayectos ilustrativos. La credencial de tu proveedor de GPS se captura aquí abajo, en «Credenciales de tus sistemas».',
      falta: ['capturar el acceso de tu proveedor de rastreo y probar la conexión'],
    };
  }

  const nombres = s.conectores.join(', ');
  // Capturar un proveedor SIN lector de posiciones no trae nada, y callarlo
  // dejaría al dueño esperando un mapa que nunca se va a llenar. Ver
  // `LECTORES_POSICION`: hoy solo Samsara.
  const sinLector = s.conectores.filter((c) => lectorDe(c) === null);

  if (s.vistas !== null && s.vistas > 0) {
    return {
      ...base,
      estado: 'listo',
      detalle: `${nombres} está entrando: ${s.vistas} unidad${s.vistas === 1 ? '' : 'es'} con posición traída por el conector (el cron corre cada 5 minutos). Esta lectura NO afirma que la posición sea de hoy — eso lo dice la fecha de cada unidad en el mapa.`,
      falta: sinLector.length > 0
        ? [`de lo capturado, ${sinLector.join(', ')} todavía no tiene lector de posiciones escrito: su credencial se prueba, pero no sincroniza`]
        : [],
    };
  }

  const falta: string[] = [];
  if (s.ligadas === null) falta.push('no se pudo leer cuántas unidades tienen dispositivo ligado');
  else if (s.ligadas === 0) falta.push('ligar cada unidad con el número de dispositivo que le da tu proveedor (pantalla de Unidades) — sin eso las lecturas llegan y se cuentan como huérfanas');
  if (sinLector.length > 0) falta.push(`${sinLector.join(', ')} todavía no tiene lector de posiciones escrito: su credencial se prueba, pero no sincroniza`);

  return {
    ...base,
    estado: 'incompleto',
    detalle: `Credencial de ${nombres} guardada${s.ligadas !== null && s.ligadas > 0 ? ` y ${s.ligadas} unidad${s.ligadas === 1 ? '' : 'es'} ligada${s.ligadas === 1 ? '' : 's'} a su dispositivo` : ''}, pero el conector todavía no ha traído una sola posición. Guardar la credencial no es sincronizar.`,
    falta,
  };
}

export interface Conector {
  id: 'whatsapp' | 'correo' | 'fiscal' | 'sat' | 'portales' | 'rastreo' | 'timbrado';
  nombre: string;
  /**
   * `no_medible` = LA MEDICIÓN NO SE PUDO HACER, y es un estado propio con
   * rótulo y tono propios en `vista.tsx` — nunca se dobla sobre
   * `sin_configurar`. La cabecera de este módulo lo prometía desde el primer
   * día y hasta el ciclo 7 no existía (c7-28): «no se pudo medir» se pintaba
   * «Sin conectar», que es una afirmación sobre la flota y no sobre la lectura.
   */
  estado: 'listo' | 'incompleto' | 'sin_configurar' | 'no_medible' | 'ensayo';
  /** La verdad medida, en una línea — con su fuente. */
  detalle: string;
  /** Lo que falta, en palabras de persona (solo cuando aplica). */
  falta: string[];
}

/** Los ids del catálogo que son de rastreo. Derivado, nunca escrito a mano:
 *  una lista paralela se desincroniza en cuanto entre el sexto proveedor. */
const IDS_GPS: readonly string[] = CONECTORES_GPS.map((c) => c.id);

/** Lo medido del rastreo, con `null` = «no se pudo leer» en cada pieza. */
export interface SenalesRastreo {
  /** Los conectores de GPS con credencial ACTIVA en esta flota. */
  conectores: string[] | null;
  /** Unidades con dispositivo ligado (`unidad.gps_device_id`). */
  ligadas: number | null;
  /** Unidades a las que el poller YA les trajo una posición (`gps_visto_en`). */
  vistas: number | null;
}

export async function getConexiones(tenantId: string): Promise<Conector[]> {
  const [fiscal, rastreo, buzon] = await Promise.all([
    getFiscalDeFlota(tenantId).catch(() => null),
    // ── LA TABLA CORRECTA (arreglo de agosto-2026) ────────────────────────
    // Este renglón contaba `rastreo_credencial` (0050), que NO tiene un solo
    // escritor en `src/`: siempre daba cero y siempre decía «sin conectar»,
    // aunque la flota tuviera su token capturado. El motor de GPS
    // (`sincronizar_gps.ts`) lee `conector_credencial` (0094) —la que llena la
    // pantalla de captura de abajo— así que es la que hay que mirar. Se mide
    // donde se escribe, o el renglón miente por diseño.
    medirRastreo(tenantId),
    // El buzón de INTAKE (0095) sí es POR FLOTA: `tenant.buzon_token` decide a
    // qué flota entra cada factura que llega por correo. Tres estados a
    // propósito — `null` es "no se pudo medir", que no es lo mismo que "sin
    // buzón": afirmar lo segundo con la base caída mandaría a generar uno.
    acotada(supabaseAdmin()
      .from('tenant')
      .select('buzon_token')
      .eq('id', tenantId)
      .maybeSingle(), 'conexiones.buzon')
      .then(({ data, error }) => (error || !data ? null : Boolean(data.buzon_token))) as Promise<boolean | null>,
  ]);

  const conectores: Conector[] = [];

  // WhatsApp — el canal es del SISTEMA (un número de Likida por ahora), así
  // que su configuración se mide en el servidor; la salud POR FLOTA la dan
  // sus propios mensajes cuando los haya.
  const waConfigurado = Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  conectores.push({
    id: 'whatsapp',
    nombre: 'WhatsApp (choferes y oficina)',
    estado: waConfigurado ? 'incompleto' : 'sin_configurar',
    detalle: waConfigurado
      ? 'Variables del canal presentes en este entorno. Esto no prueba una entrega reciente de Meta ni una sesión por flota.'
      : 'El canal de WhatsApp no está configurado en este entorno.',
    falta: [],
  });

  // Correo saliente (Resend, 14-ago-2026). Igual que WhatsApp, el canal es del
  // SISTEMA —un dominio de Likida, `mail.likida.ai`— y por eso se mide en el
  // servidor y no por flota.
  //
  // Se comprueban las DOS variables, no solo la llave: con `RESEND_API_KEY`
  // pero sin dominio, `enviarCorreo` no arma el remitente y devuelve
  // `sin_configurar` — el renglón diría "listo" mientras ningún aviso sale.
  const correoListo = correoConfigurado();
  // La OTRA mitad del canal: el intake. El renglón medía solo el SALIENTE
  // (Resend configurado) y callaba si las facturas podían ENTRAR por correo —
  // que es lo que decide el buzón de la 0095, por flota.
  const intake = buzon === null
    ? 'El estado del buzón de facturas no se pudo leer ahora mismo.'
    : buzon
      ? correoListo
        ? 'Buzón de facturas activo: los XML que lleguen a la dirección de la flota entran solos al Agente de Proveedores.'
        : 'La flota tiene buzón de facturas, pero sin el dominio de correo su dirección no existe.'
      : 'Sin buzón de facturas — se genera en el Agente de Proveedores.';
  conectores.push({
    id: 'correo',
    nombre: 'Correo de avisos',
    estado: correoListo ? 'incompleto' : 'sin_configurar',
    detalle: `${correoListo
      ? `El envío está configurado hacia avisos@${process.env.RESEND_EMAIL_DOMAIN}; esta comprobación no verifica entrega, SPF ni DKIM.`
      : 'Sin configurar: los avisos por correo no salen. WhatsApp sigue funcionando.'} ${intake}`,
    // Lo que este renglón NO puede afirmar: que el correo LLEGUE. Un dominio
    // verificado y una llave válida solo prueban que se puede mandar; que no
    // caiga en spam depende de la reputación, y eso se mide con los eventos de
    // entrega, no con dos variables de entorno.
    falta: correoListo ? [] : ['conectar Resend desde el marketplace de Vercel'],
  });

  // Datos fiscales — lo que getFiscalDeFlota MIDE (es lo mismo que usa el
  // agente de facturas para llenar portales).
  conectores.push({
    id: 'fiscal',
    nombre: 'Datos fiscales de la flota',
    estado: fiscal === null ? 'sin_configurar' : fiscal.flota ? 'listo' : 'incompleto',
    detalle: fiscal === null
      ? 'No se pudieron leer ahora mismo.'
      : fiscal.flota
        ? 'Completos: con esto el agente llena portales de facturación.'
        : 'Faltan datos para facturar en portales.',
    falta: fiscal?.falta ?? [],
  });

  // Datos fiscales completos permiten construir/contrastar CFDI, pero no
  // constituyen una conexión al SAT ni prueban una consulta reciente.
  conectores.push({
    id: 'sat',
    nombre: 'SAT (validación de CFDI)',
    estado: 'ensayo',
    detalle: 'Likida no guarda e.firma ni credenciales del SAT para esta flota. La presencia de datos fiscales no prueba una consulta SAT reciente; cualquier estado de CFDI se muestra con su propia fecha/respuesta.',
    falta: ['probar una consulta de CFDI real antes de tratar la validación como disponible'],
  });

  // Portales de facturación — el catálogo que el agente sabe operar.
  const vivos = portalesVivos(tenantId).length;
  conectores.push({
    id: 'portales',
    nombre: 'Portales de facturación',
    estado: vivos > 0 ? 'listo' : 'sin_configurar',
    detalle: `${vivos} portales operables hoy para esta flota, de ${PORTALES_CONOCIDOS.length} que el agente conoce.`,
    falta: [],
  });

  // Rastreo GPS — medido contra `conector_credencial` (donde se captura y de
  // donde lee el poller) y contra `unidad.gps_visto_en` (que es lo que separa
  // «credencial guardada» de «fuente sincronizada»).
  conectores.push(renglonRastreo(rastreo));

  // Timbrado — el candado legal es una DECISIÓN, no una falla: se dice así.
  const emite = modoEfectivo(
    process.env.FACTURACION_MODO === 'emitir' ? 'emitir' : 'ensayo',
    mandatoFiscalAceptado(),
  ) === 'emitir';
  conectores.push({
    id: 'timbrado',
    nombre: 'Emisión de CFDI (timbrado)',
    estado: emite ? 'listo' : 'ensayo',
    detalle: emite
      ? 'Encendido: el agente emite en portales de verdad.'
      : 'En ensayo por candado legal — decisión de negocio: se enciende al cerrar el primer cliente (runbook en docs/encender-emision.md).',
    falta: [],
  });

  return conectores;
}
