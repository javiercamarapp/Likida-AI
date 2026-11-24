// ═══════════════════════════════════════════════════════════════════════════
// MATRIZ DE ACCIÓN — qué hace el agente con cada tipo de solicitud, como DATOS tipados.
//
// `decidirAccion` (decidir.ts) lee esta matriz y le superpone el contexto (prohibiciones, seguridad, repregunta, urgencia, ETA). Aquí
// solo hay datos: la acción cuando hay dato confirmado, la acción cuando falta, la plantilla, el aviso mínimo y lo que NUNCA se dice.
//
// Principios: dato confirmado o persona; nunca acuse vacío; el agente no promete ETA, no autoriza salidas, no cotiza falsos o demoras, no
// toca CCP/POD/DODA/sellos y no da datos del operador a quien no está verificado. Ninguna acción de esta matriz se autoenvía: toda
// respuesta con datos pasa por aprobación humana (ver `AUTOENVIABLES_MAXIMO`).
// PURO: sin base, sin red, sin modelo.
// ═══════════════════════════════════════════════════════════════════════════
import type { IdPlantilla } from './plantillas';
import type { RolDestino } from './escalamiento';
import type { TipoSolicitud } from './taxonomia';

export type Accion = 'responder_con_datos' | 'pedir_dato_a_persona' | 'avisar_encargado' | 'escalar_gerente' | 'solo_registrar' | 'prohibido';
export type NivelAviso = 'N1' | 'N2' | 'N3';

/** De menos a más conservadora: sirve para combinar varias solicitudes de un mismo mensaje (gana la más conservadora). */
export const CONSERVADURIA: Readonly<Record<Accion, number>> = Object.freeze({
  responder_con_datos: 1, pedir_dato_a_persona: 2, avisar_encargado: 3, solo_registrar: 4, escalar_gerente: 5, prohibido: 6,
});
export const RANGO_NIVEL: Readonly<Record<NivelAviso, number>> = Object.freeze({ N1: 1, N2: 2, N3: 3 });

/** Lo que el redactor nunca debe decir, en general (aplica a todos los tipos). */
export const NUNCA_DECIR_GENERAL: readonly string[] = Object.freeze([
  'Adelante / ya puedes salir / está autorizado',
  'Llega a las X / en N horas (como promesa)',
  'No habrá cargo / el falso es de X / se cobra X',
  'Ya cruzó / ya está timbrada / ya está sellada (sin registro)',
  'Reviso / valido / en breve / ya casi (sin dato ni plazo)',
  'No hay unidad / no tenemos disponibilidad (decisión humana)',
  'Es culpa de la planta o del cliente',
  'Cualquier placa, sello, licencia, teléfono o nombre que no se haya leído del sistema',
  'ETA de una planta como si fuera de otra',
]);

/** Tipos que, como máximo, podrían autoenviarse si la flota lo autoriza expresamente por tipo (hoy: ninguno por omisión). */
export const AUTOENVIABLES_MAXIMO: readonly TipoSolicitud[] = Object.freeze([
  'eta', 'estatus_planta_ingreso', 'estatus_cruce', 'estatus_ruta_detencion', 'cuenta_espejo', 'caja_vacia_colocacion',
] as TipoSolicitud[]);

export interface ReglaMatriz {
  tipo: TipoSolicitud;
  resumen: string;
  /** Claves de datos confirmados necesarias para responder con datos. [] = no depende de datos (la acción es siempre la misma). */
  requiere: readonly string[];
  /** Si `requiere` se calcula de la configuración del cliente: 'ficha' o 'qr'. */
  requiereDinamico?: 'ficha' | 'qr';
  conDatos: Accion;
  sinDatos: Accion;
  /** Plantilla de la respuesta al cliente cuando hay datos (null = no se responde al cliente). */
  plantilla: IdPlantilla | null;
  /** Aviso mínimo interno aunque haya datos. null = ninguno. */
  avisoBase: NivelAviso | null;
  ruta: RolDestino | null;
  nunca: readonly string[];
  /** La respuesta siempre espera aprobación humana (ya implementado: confianza < 0.85 siempre la pide). */
  aprobacionSiempre: boolean;
}

const r = (x: ReglaMatriz): ReglaMatriz => Object.freeze({ ...x, requiere: Object.freeze([...x.requiere]), nunca: Object.freeze([...x.nunca]) });

export const MATRIZ: Readonly<Record<TipoSolicitud, ReglaMatriz>> = Object.freeze({
  ficha_unidad: r({ tipo: 'ficha_unidad', resumen: 'Responder con la ficha confirmada y, sobre todo, anticiparla; lo faltante sale «pendiente de confirmar» y se pide a una persona.', requiere: [], requiereDinamico: 'ficha', conDatos: 'responder_con_datos', sinDatos: 'pedir_dato_a_persona', plantilla: 'ficha_unidad', avisoBase: null, ruta: null, aprobacionSiempre: true,
    nunca: ['Inventar o completar placa, licencia, caja u operador', 'Mandar la ficha de otro proyecto', 'Dos cambios de unidad en 15 min sin explicación', 'Condicionar la asignación a recibir la CCP', 'Mandar «datos en sus correos» sin dato'] }),
  eta: r({ tipo: 'eta', resumen: 'Retransmitir solo el ETA vigente con su hora de actualización; sin él, pedirlo a una persona.', requiere: [], conDatos: 'responder_con_datos', sinDatos: 'pedir_dato_a_persona', plantilla: 'eta_vigente', avisoBase: null, ruta: null, aprobacionSiempre: false,
    nunca: ['Calcular o prometer una hora', 'ETA de salida como si fuera de llegada', 'Tráfico sin evidencia', 'Rangos improvisados', 'Cambiar el ETA sin causa'] }),
  cuenta_espejo: r({ tipo: 'cuenta_espejo', resumen: 'Reenviar el enlace vigente; si venció o no existe, pedirlo a una persona.', requiere: ['cuentaEspejo'], conDatos: 'responder_con_datos', sinDatos: 'pedir_dato_a_persona', plantilla: 'cuenta_espejo', avisoBase: null, ruta: null, aprobacionSiempre: false,
    nunca: ['Enviar el enlace de otra unidad', 'Compartir el enlace con contactos no autorizados', 'Prometer ubicación exacta'] }),
  ccp: r({ tipo: 'ccp', resumen: 'No toca la carta porte: registra y avisa a importación; al cliente solo el estado confirmado.', requiere: [], conDatos: 'avisar_encargado', sinDatos: 'avisar_encargado', plantilla: 'falta_dato', avisoBase: 'N1', ruta: 'importacion_ccp', aprobacionSiempre: true,
    nunca: ['Emitir, corregir, regenerar o validar la CCP', 'Prometer hora de timbrado', 'Decir que la carta porte sellada sirve como POD'] }),
  sello_foto: r({ tipo: 'sello_foto', resumen: 'Responder solo con el sello o foto registrado; sin registro, pedirlo a una persona.', requiere: ['sello'], conDatos: 'responder_con_datos', sinDatos: 'pedir_dato_a_persona', plantilla: 'falta_dato', avisoBase: null, ruta: null, aprobacionSiempre: true,
    nunca: ['Dar o recordar un número de sello', 'Decir que «ya va»', 'Afirmar que el candado marca cerrado', 'Aceptar un sello distinto al declarado'] }),
  autorizacion_salida: r({ tipo: 'autorizacion_salida', resumen: 'Jamás emite ni sugiere la salida: registra la autorización del cliente y avisa a una persona.', requiere: [], conDatos: 'solo_registrar', sinDatos: 'solo_registrar', plantilla: null, avisoBase: 'N1', ruta: null, aprobacionSiempre: true,
    nunca: ['Ya puedes salir', 'Adelante', 'Está autorizado', 'Ya tienes luz verde (ni repitiendo al cliente)'] }),
  estatus_planta_ingreso: r({ tipo: 'estatus_planta_ingreso', resumen: 'Responder con el estado del catálogo si está registrado; si no, pedirlo.', requiere: ['estatusPlanta'], conDatos: 'responder_con_datos', sinDatos: 'pedir_dato_a_persona', plantilla: 'estatus_planta', avisoBase: null, ruta: null, aprobacionSiempre: false,
    nunca: ['Culpar al cliente por la falta de prealerta', 'Prometer hora de ingreso', 'Afirmar «ya cargó» sin estado'] }),
  estatus_cruce: r({ tipo: 'estatus_cruce', resumen: 'Responder solo si el sistema marca el hito; si no, «sin confirmación de cruce» y avisar a cruces.', requiere: ['hitoCruce'], conDatos: 'responder_con_datos', sinDatos: 'pedir_dato_a_persona', plantilla: 'estatus_cruce', avisoBase: null, ruta: 'cruces', aprobacionSiempre: false,
    nunca: ['Hora de cruce', '«Ya está en patio» sin confirmación', 'Afirmar vigencia de DODA', 'Prometer cruce «hoy»'] }),
  estatus_ruta_detencion: r({ tipo: 'estatus_ruta_detencion', resumen: 'Responder con la posición y el tiempo confirmados por GPS; avisar a monitoreo si la parada no es autorizada.', requiere: ['posicionGps'], conDatos: 'responder_con_datos', sinDatos: 'pedir_dato_a_persona', plantilla: 'detencion', avisoBase: null, ruta: 'monitoreo', aprobacionSiempre: false,
    nunca: ['Inventar el motivo de la detención', 'Justificar o autorizar la parada', '«Ya reanuda» sin hora de reinicio registrada'] }),
  caja_vacia_colocacion: r({ tipo: 'caja_vacia_colocacion', resumen: 'Responder solo con caja confirmada; sin ella, pedirla a control de equipo.', requiere: ['cajaVaciaConfirmada'], conDatos: 'responder_con_datos', sinDatos: 'pedir_dato_a_persona', plantilla: 'colocacion_remolque', avisoBase: null, ruta: 'control_equipo', aprobacionSiempre: false,
    nunca: ['«Mañana la colocamos»', 'Confirmar disponibilidad por decisión propia', 'Mover cajas de otra línea', 'Afirmar saldo de «cajas debidas»'] }),
  pool_programa: r({ tipo: 'pool_programa', resumen: 'Programa recibido: acuse con lectura sin confirmar capacidad. Inventario: solo si está confirmado.', requiere: ['inventarioConfirmado'], conDatos: 'responder_con_datos', sinDatos: 'pedir_dato_a_persona', plantilla: 'confirmacion_programa', avisoBase: null, ruta: 'control_equipo', aprobacionSiempre: true,
    nunca: ['Confirmar «se mantiene el programa» sin humano', 'Confirmar disponibilidad de unidades', 'Dar el programa de otro cliente'] }),
  prealerta_acceso: r({ tipo: 'prealerta_acceso', resumen: 'Avisar al encargado y decirle al cliente cuándo se enviaron los datos, sin culpar.', requiere: [], conDatos: 'avisar_encargado', sinDatos: 'avisar_encargado', plantilla: 'prealerta', avisoBase: 'N1', ruta: null, aprobacionSiempre: true,
    nunca: ['Resolver solo', 'Asegurar que la prealerta ya salió', 'Mandar datos distintos a los de la prealerta'] }),
  qr_acceso: r({ tipo: 'qr_acceso', resumen: 'Pedir a una persona los campos faltantes antes de que el cliente los reclame.', requiere: [], requiereDinamico: 'qr', conDatos: 'responder_con_datos', sinDatos: 'pedir_dato_a_persona', plantilla: 'qr_acceso', avisoBase: null, ruta: null, aprobacionSiempre: true,
    nunca: ['Generar o estimar un QR', 'Mandar datos incompletos'] }),
  pod_doda: r({ tipo: 'pod_doda', resumen: 'Responder solo del estado del documento; si solo hay carta porte sellada, pedir el documento correcto.', requiere: ['documentoPod'], conDatos: 'responder_con_datos', sinDatos: 'pedir_dato_a_persona', plantilla: 'falta_dato', avisoBase: 'N1', ruta: 'importacion_ccp', aprobacionSiempre: true,
    nunca: ['Enviar la carta porte como POD', 'Dar por válido un archivo ilegible', 'Prometer fecha de llegada del documento'] }),
  facturacion_documentos: r({ tipo: 'facturacion_documentos', resumen: 'Sin cotización ni aceptación de tarifas; responder solo si el documento está registrado y vigente.', requiere: ['documentoVigenteRegistrado'], conDatos: 'responder_con_datos', sinDatos: 'avisar_encargado', plantilla: 'falta_dato', avisoBase: 'N1', ruta: null, aprobacionSiempre: true,
    nunca: ['Aceptar una confirmación de tarifa', 'Comentar tarifas, montos o demoras'] }),
  cancelacion_falso: r({ tipo: 'cancelacion_falso', resumen: 'Registrar la instrucción literal, avisar y escalar el posible cobro; jamás cotizar.', requiere: [], conDatos: 'solo_registrar', sinDatos: 'solo_registrar', plantilla: null, avisoBase: 'N2', ruta: null, aprobacionSiempre: true,
    nunca: ['Cotizar falso, demora o estadía', 'Decir que «no habrá cargo»', 'Aceptar cargos', 'Cancelar por «falta de respuesta» del cliente', 'Confirmar una cancelación que solo se mencionó'] }),
  cambio_instruccion: r({ tipo: 'cambio_instruccion', resumen: 'Escalar; al cliente: «recibido; una persona confirma el cambio» y la instrucción vigente.', requiere: [], conDatos: 'escalar_gerente', sinDatos: 'escalar_gerente', plantilla: null, avisoBase: 'N2', ruta: null, aprobacionSiempre: true,
    nunca: ['Ejecutar el cambio solo', 'Entregar en otro destino', 'Retirar la unidad de un punto sin consultar'] }),
  cambio_unidad_operador: r({ tipo: 'cambio_unidad_operador', resumen: 'Avisar al encargado antes de comunicar; una sola ficha de actualización; dos cambios seguidos escalan.', requiere: [], conDatos: 'avisar_encargado', sinDatos: 'avisar_encargado', plantilla: 'ficha_unidad', avisoBase: 'N1', ruta: null, aprobacionSiempre: true,
    nunca: ['Mandar una ficha nueva sin confirmación', 'Ocultar el cambio', 'Tocar documentos (nueva CCP, DODA, prealerta o QR)'] }),
  incidencia: r({ tipo: 'incidencia', resumen: 'Escalar de inmediato; al cliente solo lo confirmado y quién coordina.', requiere: [], conDatos: 'escalar_gerente', sinDatos: 'escalar_gerente', plantilla: null, avisoBase: 'N2', ruta: null, aprobacionSiempre: true,
    nunca: ['Asignar culpa', 'Estimar costo de reparación', 'ETA de rescate no confirmada', 'Autorizar continuar con el candado abierto'] }),
  datos_operador: r({ tipo: 'datos_operador', resumen: 'Nunca responde con datos del operador sin un solicitante verificado; y aun verificado decide una persona.', requiere: [], conDatos: 'avisar_encargado', sinDatos: 'solo_registrar', plantilla: null, avisoBase: 'N2', ruta: 'seguridad', aprobacionSiempre: true,
    nunca: ['Teléfono, ubicación exacta, licencia, domicilio o nombre a no autorizados', 'Confirmar o negar que un operador «está» en un viaje'] }),
  candado_gps_stock: r({ tipo: 'candado_gps_stock', resumen: 'Responder con el conteo del patio; sin existencias, avisar.', requiere: ['existenciasCandadosGps'], conDatos: 'responder_con_datos', sinDatos: 'avisar_encargado', plantilla: null, avisoBase: null, ruta: 'control_equipo', aprobacionSiempre: false,
    nunca: ['Prometer entrega sin existencia'] }),
  custodia: r({ tipo: 'custodia', resumen: 'Avisar de inmediato; el agente no confirma identidad ni número de custodias.', requiere: [], conDatos: 'avisar_encargado', sinDatos: 'avisar_encargado', plantilla: null, avisoBase: 'N1', ruta: 'seguridad', aprobacionSiempre: true,
    nunca: ['Confirmar que las custodias son las correctas', 'Confirmar el número de custodias'] }),
  urgencia: r({ tipo: 'urgencia', resumen: 'Modificador: sube la prioridad y obliga a avisar al encargado.', requiere: [], conDatos: 'avisar_encargado', sinDatos: 'avisar_encargado', plantilla: null, avisoBase: 'N1', ruta: null, aprobacionSiempre: true, nunca: [] }),
  otro: r({ tipo: 'otro', resumen: 'Lo no reconocido va siempre a una persona; nunca se contesta algo que no se entiende.', requiere: [], conDatos: 'avisar_encargado', sinDatos: 'avisar_encargado', plantilla: null, avisoBase: 'N1', ruta: null, aprobacionSiempre: true, nunca: [] }),
});
