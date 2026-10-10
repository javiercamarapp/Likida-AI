// ═══════════════════════════════════════════════════════════════════════════
// LA PUESTA EN MARCHA DE UNA FLOTA NUEVA — checklist con estado REAL (W2).
//
// «Un tenant nuevo (250 camiones, 250 choferes, patios, jefes) tiene que poder
// operar sin tocar la base de datos». La guía vieja («Tu primera liquidación») eran
// 4 pasos que arrancaban en «da de alta a tu primer operador» y no sabían nada de
// los datos del responsable, el número de WhatsApp, los patios ni las invitaciones.
//
// Esto es el checklist completo. Dos reglas lo gobiernan:
//
//  · NADA SE PALOMEA POR CORTESÍA. Cada paso se calcula de una señal real del
//    tenant (filas, configuración declarada). Un paso cuya señal NO SE PUDO LEER
//    es `sin_dato` —«no pude comprobarlo»—, nunca `pendiente` ni `hecho`: afirmar
//    cualquiera de los dos sobre una base que no contestó es inventar.
//  · LO OPCIONAL SE DICE OPCIONAL y no cuenta para el avance: una flota con un
//    solo patio no necesita patios.
//
// `armarPasos` es PURA (se prueba sin base); `leerSenales` junta las señales y
// cada una cae a `null` por separado — una consulta caída no tumba el checklist.
// ═══════════════════════════════════════════════════════════════════════════

import type { NumeroWhatsApp } from './arranque_whatsapp';
import type { PrimerosPasos } from './primeros-pasos';

export type EstadoPaso = 'hecho' | 'pendiente' | 'sin_dato';
export type GrupoPaso = 'flota' | 'gente' | 'operacion';

export interface PasoMarcha {
  id: string;
  grupo: GrupoPaso;
  titulo: string;
  /** Lo que significa, o lo que se encontró. */
  detalle: string;
  estado: EstadoPaso;
  href: string;
  cta: string;
  /** No cuenta para el avance. */
  opcional: boolean;
  /** Lo hace el dueño (o Likida): al jefe de tráfico se le muestra sin botón. */
  soloDueno: boolean;
}

/** Lo que se sabe del tenant; `null` = no se pudo leer (≠ cero, ≠ falso). */
export interface SenalesMarcha {
  /** razón social + domicilio capturados (los que el aviso de privacidad necesita). */
  datosResponsable: boolean | null;
  perfilFiscalListo: boolean | null;
  numeroWhatsApp: NumeroWhatsApp;
  patios: number | null;
  operadores: { activos: number; pendientesDeInvitar: number } | null;
  unidadesActivas: number | null;
  politicaPropia: boolean | null;
  jefes: number | null;
  primerosPasos: PrimerosPasos | null;
}

const por = (b: boolean | null): EstadoPaso => (b === null ? 'sin_dato' : b ? 'hecho' : 'pendiente');

export function armarPasos(s: SenalesMarcha, sufijo = ''): PasoMarcha[] {
  const h = (ruta: string) => `${ruta}${sufijo}`;
  const n = s.numeroWhatsApp;
  const whatsappEstado: EstadoPaso = n.estado === 'configurado' && !n.esPrueba ? 'hecho' : 'pendiente';
  const whatsappDetalle = n.estado === 'configurado'
    ? (n.esPrueba ? `El número configurado (${n.visible}) es de PRUEBA: no atiende a choferes reales.` : `Tus choferes le escriben a ${n.visible}.`)
    : n.estado === 'invalido'
      ? 'El número configurado no es válido: pídele a soporte que lo corrija.'
      : 'Likida todavía no activa el número de WhatsApp en tu cuenta: pídelo desde el Centro de ayuda.';

  const op = s.operadores;
  const unidades = s.unidadesActivas;
  const primeros = s.primerosPasos;

  return [
    {
      id: 'datos_responsable', grupo: 'flota', titulo: 'Datos del responsable de tu flota',
      detalle: s.datosResponsable === false
        ? 'Falta la razón social o el domicilio. Salen en el aviso de privacidad que cada chofer lee en su primer mensaje: sin ellos el bot frena al chofer.'
        : 'Razón social y domicilio: salen en el aviso de privacidad que cada chofer lee en su primer mensaje.',
      estado: por(s.datosResponsable), href: h('/dashboard/soporte'), cta: 'Pedir que los capturen', opcional: false, soloDueno: true,
    },
    {
      id: 'perfil_fiscal', grupo: 'flota', titulo: 'Perfil fiscal de la flota',
      detalle: 'Las dos preguntas del umbral de peaje. Sin ellas el estímulo sale en $0 hasta declararlas.',
      estado: por(s.perfilFiscalListo), href: h('/dashboard/onboarding'), cta: 'Completar el perfil', opcional: false, soloDueno: true,
    },
    {
      id: 'whatsapp', grupo: 'flota', titulo: 'Número de WhatsApp de Likida',
      detalle: whatsappDetalle,
      estado: whatsappEstado, href: h('/dashboard/whatsapp'), cta: 'Ver número, enlace y QR', opcional: false, soloDueno: false,
    },
    {
      id: 'politica', grupo: 'flota', titulo: 'Política de gastos',
      detalle: s.politicaPropia === false
        ? 'Hoy usas la política heredada de la base. Declara tus topes por concepto: es la regla contra la que el motor cuadra cada viaje.'
        : 'Los topes por concepto contra los que el motor cuadra cada viaje.',
      estado: por(s.politicaPropia), href: h('/dashboard/politicas'), cta: 'Declarar mis topes', opcional: false, soloDueno: true,
    },
    {
      id: 'patios', grupo: 'gente', titulo: 'Patios',
      detalle: s.patios === null ? 'Si operas desde varios patios, créalos para repartir camiones y jefes de tráfico.'
        : s.patios > 0 ? `${s.patios} ${s.patios === 1 ? 'patio creado' : 'patios creados'}.`
          : 'Si tu flota opera desde un solo lugar, puedes saltarte este paso. Con varios patios, cada jefe de tráfico ve y corrige lo suyo.',
      estado: s.patios === null ? 'sin_dato' : s.patios > 0 ? 'hecho' : 'pendiente',
      href: h('/dashboard/patios'), cta: 'Crear patios', opcional: true, soloDueno: true,
    },
    {
      id: 'jefes', grupo: 'gente', titulo: 'Jefes de tráfico',
      detalle: s.jefes === null ? 'Invita a quien despacha y corrige operadores y unidades.'
        : s.jefes > 0 ? `${s.jefes} ${s.jefes === 1 ? 'usuario con rol' : 'usuarios con rol'} de jefe de tráfico.`
          : 'Invita a quien despacha y corrige operadores y unidades. Con un patio asignado, solo ve y corrige el suyo.',
      estado: s.jefes === null ? 'sin_dato' : s.jefes > 0 ? 'hecho' : 'pendiente',
      href: h('/dashboard/usuarios'), cta: 'Invitar a mi equipo', opcional: true, soloDueno: true,
    },
    {
      id: 'operadores', grupo: 'gente', titulo: 'Operadores dados de alta',
      detalle: op === null ? 'Uno por uno o toda tu plantilla desde un Excel o CSV.'
        : op.activos > 0 ? `${op.activos} ${op.activos === 1 ? 'operador activo' : 'operadores activos'}.`
          : 'Uno por uno o toda tu plantilla desde un Excel o CSV: con su WhatsApp, el bot sabe de quién es cada comprobante.',
      estado: op === null ? 'sin_dato' : op.activos > 0 ? 'hecho' : 'pendiente',
      href: h('/dashboard/operadores#alta'), cta: 'Dar de alta operadores', opcional: false, soloDueno: false,
    },
    {
      id: 'invitaciones', grupo: 'gente', titulo: 'Operadores invitados por WhatsApp',
      detalle: op === null ? 'Cada chofer necesita escribirle a Likida una vez desde su número.'
        : op.activos === 0 ? 'Primero da de alta a tus operadores.'
          : op.pendientesDeInvitar > 0
            ? `${op.pendientesDeInvitar} de ${op.activos} todavía sin invitación. Cada una es un mensaje de WhatsApp que tú confirmas.`
            : 'Todos los operadores activos ya fueron invitados.',
      estado: op === null ? 'sin_dato' : op.activos === 0 ? 'pendiente' : op.pendientesDeInvitar === 0 ? 'hecho' : 'pendiente',
      href: h('/dashboard/operadores'), cta: 'Invitar a mis operadores', opcional: false, soloDueno: false,
    },
    {
      id: 'unidades', grupo: 'gente', titulo: 'Unidades dadas de alta',
      detalle: unidades === null ? 'Tus camiones con sus papeles: Likida avisa cuál vence primero.'
        : unidades > 0 ? `${unidades} ${unidades === 1 ? 'unidad activa' : 'unidades activas'}.`
          : 'Tus camiones con póliza, permiso SICT y verificación: Likida avisa cuál vence primero.',
      estado: unidades === null ? 'sin_dato' : unidades > 0 ? 'hecho' : 'pendiente',
      href: h('/dashboard/unidades'), cta: 'Dar de alta unidades', opcional: false, soloDueno: false,
    },
    {
      id: 'primer_viaje', grupo: 'operacion', titulo: 'Tu primer viaje con su anticipo',
      detalle: 'Ruta, operador y anticipo. El viaje es la carpeta donde cae todo lo demás.',
      estado: primeros === null ? 'sin_dato' : primeros.viajes > 0 ? 'hecho' : 'pendiente',
      href: h('/dashboard/despacho'), cta: 'Crear un viaje', opcional: false, soloDueno: false,
    },
    {
      id: 'primer_comprobante', grupo: 'operacion', titulo: 'El primer ticket por WhatsApp',
      detalle: 'Una foto real desde el teléfono del chofer: Likida la lee, la clasifica y la cuelga del viaje.',
      estado: primeros === null ? 'sin_dato' : primeros.comprobantes > 0 ? 'hecho' : 'pendiente',
      href: h('/dashboard/whatsapp'), cta: 'Cómo arranca el chofer', opcional: false, soloDueno: false,
    },
    {
      id: 'primera_liquidacion', grupo: 'operacion', titulo: 'Tu primera liquidación cerrada',
      detalle: 'El motor cuadra gastos contra anticipo y política; tú revisas solo las excepciones.',
      estado: primeros === null ? 'sin_dato' : primeros.liquidaciones > 0 ? 'hecho' : 'pendiente',
      href: h('/dashboard/agentes/liquidacion'), cta: 'Ver liquidaciones', opcional: false, soloDueno: false,
    },
  ];
}

export interface ResumenMarcha {
  hechos: number;
  /** Los pasos que cuentan (sin los opcionales). */
  total: number;
  /** El primer paso pendiente que cuenta, para el botón «Siguiente». */
  siguiente: PasoMarcha | null;
  /** Hay pasos cuya señal no se pudo leer: el avance es un piso, no una medida. */
  hayDatoFaltante: boolean;
  completo: boolean;
}

export function resumenMarcha(pasos: readonly PasoMarcha[]): ResumenMarcha {
  const cuentan = pasos.filter((p) => !p.opcional);
  const hechos = cuentan.filter((p) => p.estado === 'hecho').length;
  const hayDatoFaltante = pasos.some((p) => p.estado === 'sin_dato');
  return {
    hechos, total: cuentan.length,
    siguiente: cuentan.find((p) => p.estado === 'pendiente') ?? null,
    hayDatoFaltante,
    completo: hechos === cuentan.length,
  };
}
