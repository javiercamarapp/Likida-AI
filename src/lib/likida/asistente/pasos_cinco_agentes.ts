// ═══════════════════════════════════════════════════════════════════════════
// ASISTENTE DE PUESTA EN MARCHA (perfil cinco_agentes) — lógica PURA.
//
// Sin React, sin base, sin fecha: recibe señales ya leídas y devuelve los pasos con su estado. Se importa tanto en el
// servidor (primer render) como en el cliente (que le suma las declaraciones humanas guardadas en el navegador).
//
// Reglas (PLAN-MAESTRO §2.5, E-25):
//  · NADA se marca `listo` por cortesía: cada `listo` nombra su evidencia (una medición o una confirmación de la persona,
//    etiquetada como tal).
//  · Una señal que no se pudo leer es `sin_dato` («no pude comprobarlo»): nunca `pendiente` ni `listo`. null ≠ 0.
//  · Cada paso que no avanza dice DE QUIÉN es la falta, con nombre. Los nombres vienen en `Responsables` (datos de la
//    cuenta), no del código: el código jamás nombra a un cliente.
//  · Ruta crítica = 6 pasos que cuentan. El resto va en «Después» y no cuenta para el avance.
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoAsistente =
  | 'listo' | 'pendiente' | 'en_curso' | 'atencion' | 'en_espera' | 'bloqueado' | 'omitido' | 'sin_dato';

export type ClaveResponsable = 'tu_lado' | 'ti_tms' | 'likida' | 'gerencia';

/** Cómo se llama cada responsable en ESTA cuenta (p. ej. «Tu lado (Fulana)»). Valores por omisión genéricos. */
export interface Responsables {
  tu_lado: string;
  ti_tms: string;
  likida: string;
  gerencia: string;
}

export const RESPONSABLES_POR_OMISION: Responsables = {
  tu_lado: 'Tu lado',
  ti_tms: 'El área de sistemas de tu sistema de transporte',
  likida: 'Likida',
  gerencia: 'Gerencia',
};

export type IdPaso = 'equipo' | 'tms' | 'correo' | 'catalogos' | 'carta_porte' | 'simulacro'
  | 'whatsapp' | 'peajes' | 'vigia_conductor' | 'legal';

/** Lo que la persona declara (se guarda en su navegador). Siempre se muestra etiquetado como declaración. */
export interface Declaraciones {
  equipoInvitado?: boolean;
  correoRecibido?: boolean;
  simulacroVisto?: boolean;
  omitidos?: Partial<Record<IdPaso, string>>;
}

export interface SenalesAsistente {
  /** Credenciales del sistema de transporte. `null` = no se pudo leer. */
  tms: { activa: boolean; probadaEn: string | null; ultimoError: string | null } | 'sin_credencial' | null;
  /** Desgloses ya recibidos por la plataforma (el archivo de muestra). `null` = no se pudo leer. */
  archivosRecibidos: number | null;
  /** ¿La plataforma puede mandar correo? (variables de entorno, NO prueba entrega.) */
  correoPlataforma: boolean | null;
  /** Configuración del desglose por correo de la flota. `null` = no se pudo leer. */
  correoDesglose: { activa: boolean; usaCorreo: boolean; remitenteCapturado: boolean } | null;
  operadores: { activos: number; conCorreo: number | null } | null;
  unidadesActivas: number | null;
  patios: number | null;
  /** Jefes de tráfico (rol «encargado») activos. */
  coordinadores: number | null;
  /** De ellos, los que ya tienen patio asignado. */
  supervisores: number | null;
  /** ¿Hay una persona designada para revisar los borradores de Carta Porte? */
  revisorCartaPorte: boolean | null;
}

export interface Evidencia {
  /** `medido` = lo leyó la plataforma; `declarado` = lo dijo la persona; `ninguna`. */
  tipo: 'medido' | 'declarado' | 'ninguna';
  texto: string;
}

export interface Subpaso { id: string; titulo: string; estado: EstadoAsistente; detalle: string }

export interface PasoAsistente {
  id: IdPaso;
  numero: number | null;
  titulo: string;
  /** Una línea, sin jerga, como lo diría un coordinador de operaciones. */
  resumen: string;
  estado: EstadoAsistente;
  responsable: ClaveResponsable;
  /** «Falta de tu lado (Celi)» — solo cuando falta algo. */
  faltaDe: string | null;
  causa: string | null;
  evidencia: Evidencia;
  subpasos: Subpaso[];
  /** La acción principal: texto del botón y a dónde lleva (sin sufijo de tenant). */
  accion: { texto: string; href: string } | null;
  /** Qué declaración humana habilita este paso (la UI pinta el botón). */
  declara: 'equipoInvitado' | 'correoRecibido' | 'simulacroVisto' | null;
  cuenta: boolean;
}

export interface ResultadoAsistente {
  rutaCritica: PasoAsistente[];
  despues: PasoAsistente[];
  /** Pasos de la ruta crítica en `listo`. Es un piso, no una medida. */
  listos: number;
  total: number;
  /** 0–100 sobre la ruta crítica. */
  avance: number;
  /** Todo listo u omitido con motivo. */
  listoParaOperar: boolean;
  /** El próximo paso que le toca a la persona (no el que depende de otros). */
  siguiente: IdPaso | null;
}

export const ESTADOS_QUE_BLOQUEAN_AVANCE: readonly EstadoAsistente[] = ['pendiente', 'en_curso', 'atencion', 'bloqueado', 'sin_dato'];

export const ROTULO_ESTADO: Record<EstadoAsistente, string> = {
  listo: 'Listo',
  pendiente: 'Por hacer',
  en_curso: 'En curso',
  atencion: 'Necesita atención',
  en_espera: 'En espera',
  bloqueado: 'Aún no se puede',
  omitido: 'Omitido',
  sin_dato: 'No se pudo comprobar',
};

const ORDEN: IdPaso[] = ['equipo', 'tms', 'correo', 'catalogos', 'carta_porte', 'simulacro'];

function faltaDe(clave: ClaveResponsable, r: Responsables): string {
  return clave === 'tu_lado' ? `Falta de tu lado${r.tu_lado !== RESPONSABLES_POR_OMISION.tu_lado ? ` (${r.tu_lado})` : ''}` : `Falta de ${r[clave]}`;
}

type Borrador = Omit<PasoAsistente, 'faltaDe' | 'cuenta' | 'numero'>;

function paso(r: Responsables, b: Borrador, cuenta: boolean, numero: number | null): PasoAsistente {
  const sinFalta: EstadoAsistente[] = ['listo', 'omitido'];
  return { ...b, numero, cuenta, faltaDe: sinFalta.includes(b.estado) ? null : faltaDe(b.responsable, r) };
}

const ninguna = (texto = 'Sin evidencia todavía.'): Evidencia => ({ tipo: 'ninguna', texto });
const medido = (texto: string): Evidencia => ({ tipo: 'medido', texto });
const declarado = (texto: string): Evidencia => ({ tipo: 'declarado', texto });

function pasoEquipo(s: SenalesAsistente, d: Declaraciones): Borrador {
  const c = s.coordinadores;
  const declarada = d.equipoInvitado === true;
  const estado: EstadoAsistente = c !== null && c > 0 ? 'listo' : declarada ? 'listo' : c === null ? 'sin_dato' : 'en_curso';
  return {
    id: 'equipo', titulo: 'Tu equipo',
    resumen: 'Quiénes entran a Likida y qué ve cada quien.',
    estado,
    responsable: 'tu_lado', causa: null,
    // Que haya un administrador es verdad (estás aquí); los coordinadores se cuentan; a quien lleva las cuentas no se le puede contar.
    evidencia: c !== null && c > 0 ? medido(`Ya hay ${c} ${c === 1 ? 'persona que coordina' : 'personas que coordinan'}.`)
      : declarada ? declarado('Lo confirmaste tú: ya invitaste a tu equipo.')
        : ninguna('Ya hay un administrador: tú. Falta invitar a quien coordina la operación.'),
    subpasos: [
      { id: 'admin', titulo: 'Administrador de la cuenta', estado: 'listo', detalle: 'Ya entraste con tu cuenta de administrador.' },
      {
        id: 'coordina', titulo: 'Quien coordina la operación',
        estado: c === null ? 'sin_dato' : c > 0 ? 'listo' : declarada ? 'listo' : 'pendiente',
        detalle: c === null ? 'No pudimos contar a tu equipo.' : 'Ve viajes, mapa y documentos; no ve dinero.',
      },
      { id: 'cuentas', titulo: 'Quien lleva las cuentas', estado: declarada ? 'listo' : 'pendiente', detalle: 'Ve liquidaciones y peajes; no ve la operación. No podemos contarlo: lo declaras tú.' },
    ],
    accion: { texto: 'Invitar a mi equipo', href: '/dashboard/usuarios' },
    declara: estado === 'listo' || estado === 'sin_dato' ? null : 'equipoInvitado',
  };
}

function pasoTms(s: SenalesAsistente): Borrador {
  const archivo: EstadoAsistente = s.archivosRecibidos === null ? 'sin_dato' : s.archivosRecibidos > 0 ? 'listo' : 'pendiente';
  let api: EstadoAsistente;
  let apiDetalle: string;
  let causa: string | null = null;
  if (s.tms === null) { api = 'sin_dato'; apiDetalle = 'No pudimos revisar la conexión ahora. Vuelve a cargar en un minuto.'; }
  else if (s.tms === 'sin_credencial') { api = 'en_espera'; apiDetalle = 'Todavía no hay acceso a la API de tu sistema. Es una mejora: mientras tanto sigues con archivos.'; }
  else if (!s.tms.activa) { api = 'omitido'; apiDetalle = 'La credencial está desactivada.'; }
  else if (s.tms.ultimoError) { api = 'atencion'; causa = s.tms.ultimoError; apiDetalle = 'La última prueba falló. Casi siempre es un tema de red o de permisos, no de tu cuenta.'; }
  else if (s.tms.probadaEn) { api = 'listo'; apiDetalle = 'La prueba contra tu sistema salió bien.'; }
  else { api = 'en_curso'; apiDetalle = 'Acceso guardado, pero sin probar contra tu sistema todavía.'; }

  const subpasos: Subpaso[] = [
    {
      id: 'archivo', titulo: 'Entregar archivo de muestra', estado: archivo,
      detalle: archivo === 'listo' ? 'Ya recibimos un archivo y lo estamos leyendo.' : archivo === 'sin_dato' ? 'No pudimos revisar si ya llegó un archivo.' : 'Un desglose de muestra exportado de tu sistema. Con eso arrancamos hoy mismo.',
    },
    { id: 'api', titulo: 'Conexión directa a tu sistema (API)', estado: api, detalle: apiDetalle },
  ];

  let estado: EstadoAsistente;
  if (archivo === 'listo' || api === 'listo') estado = 'listo';
  else if (api === 'atencion') estado = 'atencion';
  else if (archivo === 'sin_dato' && api === 'sin_dato') estado = 'sin_dato';
  else if (api === 'en_curso') estado = 'en_curso';
  else estado = 'pendiente';

  const evid = archivo === 'listo' ? medido('Llegó al menos un archivo de muestra.') : api === 'listo' ? medido('La prueba de la conexión salió bien.') : ninguna();
  return {
    id: 'tms', titulo: 'Tu sistema de transporte',
    resumen: 'De dónde salen los viajes: por archivo hoy, por conexión directa cuando tu área de sistemas la libere.',
    estado, responsable: estado === 'atencion' || estado === 'en_curso' ? 'ti_tms' : 'tu_lado',
    causa, evidencia: evid, subpasos,
    accion: archivo === 'listo' ? { texto: 'Ver conexiones', href: '/dashboard/conexiones' } : { texto: 'Entregar archivo de muestra', href: '/dashboard/agentes/liquidacion' },
    declara: null,
  };
}

function pasoCorreo(s: SenalesAsistente, d: Declaraciones): Borrador {
  const recibido = d.correoRecibido === true;
  let estado: EstadoAsistente;
  let responsable: ClaveResponsable = 'tu_lado';
  let ev = ninguna();
  let resumen = 'Que los desgloses lleguen al correo de cada operador.';
  const sub: Subpaso[] = [];

  const plataforma = s.correoPlataforma;
  sub.push({
    id: 'canal', titulo: 'Envío de correo de Likida',
    estado: plataforma === null ? 'sin_dato' : plataforma ? 'listo' : 'en_espera',
    detalle: plataforma === null ? 'No pudimos revisar el envío.' : plataforma ? 'Likida puede mandar correos. Eso no prueba que lleguen: por eso va la prueba.' : 'Likida todavía no enciende el envío de correo en esta plataforma.',
  });
  const cfg = s.correoDesglose;
  sub.push({
    id: 'config', titulo: 'Desglose por correo activado',
    estado: cfg === null ? 'sin_dato' : cfg.activa && cfg.usaCorreo ? 'listo' : 'pendiente',
    detalle: cfg === null ? 'No pudimos leer tu configuración.' : cfg.activa && cfg.usaCorreo ? 'Activado: los desgloses salen por correo.' : 'Falta activarlo en la configuración de Liquidación.',
  });
  sub.push({ id: 'prueba', titulo: 'Prueba a tu propio correo', estado: recibido ? 'listo' : 'pendiente', detalle: recibido ? 'Confirmaste que te llegó.' : 'Mándate una prueba y confirma si llegó.' });

  if (plataforma === null && cfg === null) estado = 'sin_dato';
  else if (plataforma === false) { estado = 'en_espera'; responsable = 'likida'; }
  else if (cfg === null) estado = 'sin_dato';
  else if (!(cfg.activa && cfg.usaCorreo)) estado = 'pendiente';
  else if (recibido) { estado = 'listo'; ev = declarado('Lo confirmaste tú: la prueba llegó a tu correo.'); }
  else estado = 'en_curso';
  if (estado === 'en_curso') ev = medido('Todo configurado. Falta ver llegar una prueba.');

  return {
    id: 'correo', titulo: 'Correo', resumen, estado, responsable, causa: null, evidencia: ev, subpasos: sub,
    accion: estado === 'pendiente' ? { texto: 'Configurar el desglose por correo', href: '/dashboard/agentes/liquidacion/configuracion' } : null,
    declara: estado === 'en_curso' ? 'correoRecibido' : null,
  };
}

function pasoCatalogos(s: SenalesAsistente): Borrador {
  const op = s.operadores;
  const sub: Subpaso[] = [
    {
      id: 'operadores', titulo: 'Operadores con correo',
      estado: op === null ? 'sin_dato' : op.conCorreo === null ? 'sin_dato' : op.activos > 0 && op.conCorreo > 0 ? 'listo' : 'pendiente',
      detalle: op === null ? 'No pudimos leer los operadores.' : op.activos === 0 ? 'Todavía no hay operadores dados de alta.' : op.conCorreo === null ? `${op.activos} dados de alta; no pudimos contar cuántos tienen correo.` : `${op.conCorreo} de ${op.activos} tienen correo.`,
    },
    {
      id: 'unidades', titulo: 'Unidades',
      estado: s.unidadesActivas === null ? 'sin_dato' : s.unidadesActivas > 0 ? 'listo' : 'pendiente',
      detalle: s.unidadesActivas === null ? 'No pudimos leer las unidades.' : s.unidadesActivas === 0 ? 'Todavía no hay unidades.' : `${s.unidadesActivas} unidades activas.`,
    },
    {
      id: 'supervisores', titulo: 'Supervisores',
      estado: s.supervisores === null ? 'sin_dato' : s.supervisores > 0 ? 'listo' : 'pendiente',
      detalle: s.supervisores === null ? 'No pudimos leer los supervisores.' : s.supervisores === 0 ? 'Falta decir quién supervisa a quién.' : `${s.supervisores} con patio asignado.`,
    },
  ];
  const nucleo = sub.slice(0, 2);
  let estado: EstadoAsistente;
  if (nucleo.every((x) => x.estado === 'sin_dato')) estado = 'sin_dato';
  else if (nucleo.every((x) => x.estado === 'listo')) estado = 'listo';
  else if (nucleo.some((x) => x.estado === 'listo')) estado = 'en_curso';
  else estado = 'pendiente';
  return {
    id: 'catalogos', titulo: 'Operadores, unidades y supervisores',
    resumen: 'La gente y las unidades que van a salir en los desgloses.',
    estado, responsable: 'tu_lado', causa: null,
    evidencia: estado === 'listo' ? medido('Hay operadores con correo y unidades dados de alta.') : ninguna(),
    subpasos: sub,
    accion: { texto: 'Cargar operadores', href: '/dashboard/operadores' },
    declara: null,
  };
}

function pasoCartaPorte(s: SenalesAsistente): Borrador {
  const estado: EstadoAsistente = s.revisorCartaPorte === null ? 'sin_dato' : s.revisorCartaPorte ? 'listo' : 'pendiente';
  return {
    id: 'carta_porte', titulo: 'Quién revisa la Carta Porte',
    resumen: 'La persona que aprueba cada borrador antes de que salga.',
    estado, responsable: 'tu_lado', causa: null,
    evidencia: estado === 'listo' ? medido('Hay una persona designada como revisora.') : ninguna(),
    subpasos: [],
    accion: { texto: 'Designar revisor', href: '/dashboard/agentes/carta-porte/configuracion' },
    declara: null,
  };
}

function pasoSimulacro(previos: Borrador[], s: SenalesAsistente, d: Declaraciones): Borrador {
  const tms = previos.find((p) => p.id === 'tms')!;
  const correo = previos.find((p) => p.id === 'correo')!;
  const catalogos = previos.find((p) => p.id === 'catalogos')!;
  const faltan = [tms, correo, catalogos].filter((p) => p.estado !== 'listo');
  const visto = d.simulacroVisto === true;
  let estado: EstadoAsistente;
  let ev = ninguna();
  if (faltan.length > 0 && !visto) estado = 'bloqueado';
  else if (visto) { estado = 'listo'; ev = declarado('Lo confirmaste tú: el desglose de muestra llegó a tu correo.'); }
  else estado = 'pendiente';
  void s;
  return {
    id: 'simulacro', titulo: 'Simulacro de punta a punta',
    resumen: 'Un desglose de muestra, del archivo al correo de un operador.',
    estado, responsable: 'tu_lado',
    causa: estado === 'bloqueado' ? `Antes hace falta: ${faltan.map((p) => p.titulo.toLowerCase()).join(', ')}.` : null,
    evidencia: ev,
    subpasos: faltan.map((p) => ({ id: p.id, titulo: p.titulo, estado: p.estado, detalle: 'Se cierra antes del simulacro.' })),
    accion: estado === 'pendiente' ? { texto: 'Hacer el simulacro', href: '/dashboard/agentes/liquidacion' } : null,
    declara: estado === 'pendiente' ? 'simulacroVisto' : null,
  };
}

/** Pasos de «Después»: no cuentan para el avance y no se marcan listos sin lectura. */
function pasosDespues(): Borrador[] {
  const base = { causa: null, evidencia: ninguna('Sin lectura disponible todavía.'), subpasos: [] as Subpaso[], accion: null, declara: null } as const;
  return [
    { id: 'whatsapp', titulo: 'WhatsApp con tus operadores', resumen: 'Depende de la verificación del número ante Meta; Likida la gestiona.', estado: 'en_espera', responsable: 'likida', ...base },
    { id: 'peajes', titulo: 'Peajes: TAGs y casetas', resumen: 'Se arma cuando mandes tu primer estado de cuenta de casetas.', estado: 'pendiente', responsable: 'tu_lado', ...base, accion: { texto: 'Ir a Peajes', href: '/dashboard/agentes/peajes/configuracion' } },
    { id: 'vigia_conductor', titulo: 'Servicio al cliente y comunicación con operadores', resumen: 'Se encienden después, cuando WhatsApp esté verificado.', estado: 'bloqueado', responsable: 'likida', ...base },
    { id: 'legal', titulo: 'Aviso de privacidad y contrato de datos', resumen: 'Likida y tu gerencia lo cierran con la versión vigente.', estado: 'en_espera', responsable: 'gerencia', ...base },
  ];
}

export function armarPasosCincoAgentes(
  s: SenalesAsistente,
  d: Declaraciones = {},
  responsables: Responsables = RESPONSABLES_POR_OMISION,
): ResultadoAsistente {
  const previos: Borrador[] = [pasoEquipo(s, d), pasoTms(s), pasoCorreo(s, d), pasoCatalogos(s), pasoCartaPorte(s)];
  const todos = [...previos, pasoSimulacro(previos, s, d)];
  const aplicar = (b: Borrador): Borrador => {
    const motivo = d.omitidos?.[b.id];
    return motivo && b.estado !== 'listo'
      ? { ...b, estado: 'omitido', evidencia: declarado(`Lo omitiste tú: ${motivo}`), declara: null }
      : b;
  };
  const rutaCritica = ORDEN.map((id, i) => paso(responsables, aplicar(todos.find((p) => p.id === id)!), true, i + 1));
  const despues = pasosDespues().map((b) => paso(responsables, b, false, null));
  const listos = rutaCritica.filter((p) => p.estado === 'listo').length;
  const siguiente = rutaCritica.find((p) => ESTADOS_QUE_BLOQUEAN_AVANCE.includes(p.estado) && p.responsable === 'tu_lado' && p.estado !== 'bloqueado')?.id
    ?? rutaCritica.find((p) => ESTADOS_QUE_BLOQUEAN_AVANCE.includes(p.estado))?.id ?? null;
  return {
    rutaCritica, despues, listos, total: rutaCritica.length,
    avance: Math.round((listos / rutaCritica.length) * 100),
    listoParaOperar: rutaCritica.every((p) => p.estado === 'listo' || p.estado === 'omitido'),
    siguiente,
  };
}
