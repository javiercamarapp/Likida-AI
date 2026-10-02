import { probarConGuardas, type CampoCredencial, type Conector, type Http, type ResultadoPrueba, type ValoresCredencial } from '../tipos';
import { ErrorTablaPropia, MODOS_TABLA_PROPIA, PROVEEDOR_TABLA_PROPIA } from './contrato';
import { crearLectorTablaPropia } from './lector';
import type { ClienteSftp } from './sftp';
import type { EjecutorSql } from './sql';

// ═══════════════════════════════════════════════════════════════════════════
// EL CONECTOR «TABLA PROPIA»: la flota que ya guarda las posiciones de todos
// sus GPS en sus propias tablas. Se guarda como cualquier otra credencial de
// conector (cifrada con el cofre), se sondea con el MISMO poller de GPS
// (cron `gps`, con su backoff por clase de falla y su latido) y asienta en
// `posicion` por el MISMO asentador, de modo que el Conductor, los Peajes, el
// mapa y la jornada consumen exactamente lo mismo que con Samsara.
// ═══════════════════════════════════════════════════════════════════════════

const CAMPOS: readonly CampoCredencial[] = [
  { clave: 'modo', rotulo: 'Cómo leemos sus tablas', forma: 'texto', requerida: true, ayuda: `Uno de: ${MODOS_TABLA_PROPIA.join(', ')}. «sql_solo_lectura»: un usuario de solo lectura sobre una vista; «csv_sftp»: un archivo CSV en una dirección https o en un servidor SFTP (sftp://); «endpoint»: una dirección de su sistema que devuelve JSON.`, ejemplo: 'sql_solo_lectura' },
  { clave: 'zona', rotulo: 'Zona horaria de su fecha_hora', forma: 'texto', requerida: false, ayuda: 'La zona en la que su sistema escribe la fecha cuando NO trae zona (Región/Ciudad). Si la fecha ya trae zona (Z o -06:00) se respeta tal cual. Por omisión, hora de Ciudad de México.', ejemplo: 'Region/Ciudad' },
  { clave: 'ventana_minutos', rotulo: 'Cuánto hacia atrás leer en cada vuelta (minutos)', forma: 'texto', requerida: false, ayuda: 'De 1 a 1,440; por omisión 30. Repetir la ventana es seguro: una posición ya guardada no se duplica. Una posición que su sistema sube DESPUÉS de esa ventana (búfer tardío) no se lee: para eso está el barrido largo.', ejemplo: '30' },
  { clave: 'barrido_largo_minutos', rotulo: 'Barrido largo cada hora (minutos hacia atrás; 0 = apagado)', forma: 'texto', requerida: false, ayuda: 'Si sus unidades suben posiciones con retraso al recuperar señal (un búfer con la hora de cuando se midió cada punto), la ventana normal ya pasó de largo y esos puntos no se leen. Con este valor (0, o de 60 a 1,440 y mayor que la ventana), la vuelta de la primera hora lee hacia atrás tanto tiempo; repetir lectura es seguro. Apagado por omisión: sube la carga sobre su base.', ejemplo: '360' },
  { clave: 'limite_filas', rotulo: 'Máximo de filas por lectura', forma: 'texto', requerida: false, ayuda: 'De 1 a 200,000; por omisión 50,000.', ejemplo: '50000' },
  // SQL
  { clave: 'sql_host', rotulo: 'SQL: servidor', forma: 'texto', requerida: false, ayuda: 'Nombre o dirección PÚBLICA de la réplica o vista que nos habilitaron. No se admiten direcciones internas.', ejemplo: 'replica.suempresa.com' },
  { clave: 'sql_puerto', rotulo: 'SQL: puerto', forma: 'texto', requerida: false, ayuda: 'Por omisión 5432.', ejemplo: '5432' },
  { clave: 'sql_base', rotulo: 'SQL: base de datos', forma: 'texto', requerida: false, ayuda: 'El nombre de la base.', ejemplo: 'flota' },
  { clave: 'sql_usuario', rotulo: 'SQL: usuario de SOLO LECTURA', forma: 'texto', requerida: false, ayuda: 'Un usuario que solo pueda leer la vista de posiciones. No se usa ninguno con permisos de escritura.', ejemplo: 'likida_lectura' },
  { clave: 'sql_clave', rotulo: 'SQL: contraseña', forma: 'secreto', requerida: false, ayuda: 'La contraseña de ese usuario. Se guarda cifrada y no vuelve a mostrarse.' },
  { clave: 'sql_ssl', rotulo: 'SQL: certificado', forma: 'texto', requerida: false, ayuda: '«verificar» (por omisión) exige un certificado válido; «sin_verificar» acepta uno propio. La conexión nunca va en claro.', ejemplo: 'verificar' },
  { clave: 'vista', rotulo: 'SQL: vista de posiciones', forma: 'texto', requerida: false, ayuda: 'El nombre de la vista (nombre o esquema.nombre). Solo se hace SELECT sobre ella.', ejemplo: 'esquema.vista_posiciones' },
  { clave: 'columnas', rotulo: 'SQL: columnas de la vista (JSON)', forma: 'texto', requerida: false, ayuda: 'Qué columna es cada dato: unidad (su número económico), lat, lon, fecha_hora, y opcionalmente velocidad_kmh e ignicion.', ejemplo: '{"unidad":"...","lat":"..."}' },
  { clave: 'vista_geocercas', rotulo: 'SQL: vista de geocercas (opcional)', forma: 'texto', requerida: false, ayuda: 'Para importar sus geocercas como sitios.', ejemplo: 'esquema.vista_geocercas' },
  { clave: 'columnas_geocercas', rotulo: 'SQL: columnas de geocercas (JSON)', forma: 'texto', requerida: false, ayuda: 'codigo, nombre y (lat_centro, lon_centro, radio_m) o poligono_wkt; opcional cliente.', ejemplo: '{"codigo":"...","nombre":"..."}' },
  // CSV / endpoint
  { clave: 'base_url', rotulo: 'Dirección del archivo CSV o del endpoint (https o sftp)', forma: 'url', requerida: false, ayuda: 'https y pública; o, solo con csv_sftp, sftp://servidor[:puerto]/ruta/archivo.csv (servidor público; sin usuario ni clave dentro de la dirección: van en sus propios campos). Con sftp:// es obligatoria la huella del servidor (huella_host).', ejemplo: 'https://su-sistema.com/posiciones.csv' },
  { clave: 'patron', rotulo: 'Cómo se manda la credencial', forma: 'texto', requerida: false, ayuda: 'ninguna, bearer, cabecera, query o basic (por omisión, ninguna).', ejemplo: 'bearer' },
  { clave: 'nombre_campo', rotulo: 'Nombre de la cabecera o del parámetro (o usuario si es basic o SFTP)', forma: 'texto', requerida: false, ayuda: 'Solo con cabecera, query o basic. Con sftp:// es el usuario SFTP.', ejemplo: 'X-API-Key' },
  { clave: 'token', rotulo: 'Token o clave del endpoint (o contraseña SFTP)', forma: 'secreto', requerida: false, ayuda: 'La credencial de su sistema, si pide una. Con sftp:// es la contraseña del usuario (o déjala vacía si entras con llave privada).' },
  { clave: 'llave_privada', rotulo: 'SFTP: llave privada (alternativa a la contraseña)', forma: 'secreto', requerida: false, ayuda: 'La llave privada del usuario SFTP completa, de «-----BEGIN …» a «-----END …» (se acepta pegada en una sola línea). Se guarda cifrada y no vuelve a mostrarse.' },
  { clave: 'frase_llave', rotulo: 'SFTP: frase de la llave privada', forma: 'secreto', requerida: false, ayuda: 'Solo si la llave privada está protegida con frase.' },
  { clave: 'huella_host', rotulo: 'SFTP: huella del servidor (obligatoria con sftp://)', forma: 'texto', requerida: false, ayuda: 'La huella SHA256 de la llave del servidor, la que muestra «ssh-keygen -lf» o WinSCP: SHA256:… Sin ella no se lee: así nunca mandamos la credencial a un servidor que no es el suyo. Admite varias separadas por coma para cambiar la llave del servidor sin cortar la lectura.', ejemplo: 'SHA256:AbCd…' },
  { clave: 'mapeo_posiciones', rotulo: 'Endpoint: mapeo de campos de posiciones (JSON)', forma: 'texto', requerida: false, ayuda: 'Dónde está la lista y qué campo es cada dato: lista, campos {unidad, lat, lon, fecha_hora, velocidad_kmh, ignicion}, formato_fecha, unidad_velocidad y paginacion.', ejemplo: '{"lista":"data","campos":{...}}' },
  { clave: 'geocercas_url', rotulo: 'Dirección del archivo o endpoint de geocercas (opcional)', forma: 'url', requerida: false, ayuda: 'Para importar sus geocercas como sitios. https.', ejemplo: 'https://su-sistema.com/geocercas.csv' },
  { clave: 'mapeo_geocercas', rotulo: 'Endpoint: mapeo de campos de geocercas (JSON)', forma: 'texto', requerida: false, ayuda: 'Solo con endpoint: lista y campos {codigo, nombre, lat_centro, lon_centro, radio_m | poligono_wkt, cliente}.', ejemplo: '{"campos":{"codigo":"...","nombre":"..."}}' },
];

const mostrable = (url: string | undefined): string | null => {
  try { const u = new URL(url ?? ''); return u.protocol === 'sftp:' ? `sftp://${u.host}${u.pathname}` : `${u.origin}${u.pathname}`; } catch { return null; }
};

/**
 * Prueba la configuración LEYENDO de verdad (solo lectura): valida el mapeo, lee la ventana y dice cuántas filas
 * entendió y cuántas rechazó. Un mapeo roto o una vista sin la columna salen aquí, antes del primer poll.
 */
export async function probarTablaPropia(valores: ValoresCredencial, http: Http, ejecutor?: EjecutorSql, sftp?: ClienteSftp): Promise<ResultadoPrueba> {
  const c = crearLectorTablaPropia(valores, { http, ejecutor, sftp });
  if (!c.ok) return { ok: false, detalle: `La configuración no es válida: ${c.motivo}.`, verificadoContra: null, sobreLaCredencial: 'no_se_sabe' };
  const contra = c.config.modo === 'sql_solo_lectura'
    ? `${c.config.conexion.host}:${c.config.conexion.puerto}/${c.config.conexion.base}`
    : mostrable(c.config.url);
  try {
    const r = await c.lector.leerPosiciones({ desdeUtc: new Date(Date.now() - c.config.ventanaMinutos * 60_000) });
    const motivos = [...new Set(r.rechazadas.map((x) => x.motivo))].slice(0, 3).join('; ');
    return {
      ok: true,
      detalle: `Se leyó su tabla: ${r.filas.length} posición(es) válida(s) en los últimos ${c.config.ventanaMinutos} min${r.rechazadas.length ? ` y ${r.rechazadas.length} fila(s) rechazada(s) (${motivos})` : ''}.${r.filas.length === 0 ? ' Cero filas no es error, pero confirma que la vista trae datos recientes.' : ''}`,
      verificadoContra: contra,
      sobreLaCredencial: 'sirve',
    };
  } catch (e) {
    if (e instanceof ErrorTablaPropia) {
      return { ok: false, detalle: e.message, verificadoContra: contra, sobreLaCredencial: e.falla === 'credencial' ? 'no_sirve' : 'no_se_sabe' };
    }
    throw e;
  }
}

export const TABLA_PROPIA: Conector = {
  id: PROVEEDOR_TABLA_PROPIA,
  nombre: 'Mis propias tablas de GPS',
  categoria: 'Rastreo GPS',
  queHace: 'Si tu flota ya guarda las posiciones de todos sus GPS en tus propias tablas, Likida las lee (solo lectura) y las usa en el mapa, el Conductor, los peajes y la jornada, sin comprar otro rastreo.',
  // `requiere_piloto`: la lectura está construida y probada con fixtures de contrato, pero no se ha corrido contra
  // la base real de ninguna flota; decir `api_en_vivo` sería prometer lo que nadie ha verificado.
  formaDeConectar: 'requiere_piloto',
  comoConectaHoy: 'Eliges cómo leerlas (usuario SQL de solo lectura sobre una vista, un CSV en una dirección https o en tu servidor SFTP, o un endpoint JSON), declaras qué columna es cada dato y probamos leyendo de verdad. El SQL no es libre: solo un SELECT sobre la vista declarada.',
  paraSubirDeEscalon: 'Una vista (o réplica) real con un usuario de solo lectura, o un CSV/endpoint de muestra con datos reales de su flota; para SFTP, el servidor, el usuario con contraseña o llave y la huella de su llave de host. Para SQL, además, el controlador de PostgreSQL habilitado en el despliegue.',
  capacidades: ['leer_posiciones'],
  claveAlmacen: 'otro',
  fuente: null,
  credenciales: CAMPOS,
  probar: (v, http) => probarConGuardas(TABLA_PROPIA, v, () => probarTablaPropia(v, http)),
};
