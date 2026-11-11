import type { InfoTexto } from '../info-catalogo';
import { V } from './constructores';

// Textos de ⓘ de las cifras de los paneles de Carta Porte, Operadores y Servicio al cliente (F10). Solo lo que el lector de la pantalla hace de verdad.
export const INFO_AGENTES_CPV = {
  'carta_porte_agente.en_curso': V(
    'Viajes en curso', 'Viajes de tu flota que siguen abiertos o en cuadre.',
    'Cuenta los viajes con estatus abierto o en cuadre. El veredicto de Carta Porte solo se evalúa en los más próximos; este total los cuenta todos.',
    'Viajes de tu flota, leídos al abrir la página.',
  ),
  'carta_porte_agente.esperan': V(
    'Esperan declaración', 'Viajes en curso donde el agente espera una respuesta tuya sobre la Carta Porte.',
    'Cuenta, entre los viajes evaluados, los que el árbol legal marca como «falta declarar».',
    'Los viajes más próximos de tu flota con estatus abierto o en cuadre, leídos al abrir la página.',
    'Responde lo que falta en la pantalla de Carta Porte.',
  ),
  'carta_porte_agente.necesitan': V(
    'Necesitan complemento', 'Viajes en curso cuyo veredicto es que requieren el complemento Carta Porte.',
    'Cuenta, entre los viajes evaluados, los que el árbol legal marca como «sí necesita».',
    'Los viajes más próximos de tu flota con estatus abierto o en cuadre, leídos al abrir la página.',
  ),
  'carta_porte_agente.borradores': V(
    'Borradores sin fallas', 'Viajes evaluados cuyo borrador del complemento ya está armado y sin fallas de validación.',
    'Cuenta, entre los viajes evaluados, los que tienen borrador y cero fallas en las validaciones que el PAC rechazaría seguro. No equivale a claves verificadas contra el SAT.',
    'Los viajes más próximos de tu flota con estatus abierto o en cuadre, leídos al abrir la página.',
  ),
  'carta_porte_agente.sin_tocar': V(
    'Aprobados sin tocar', 'Porcentaje de documentos aprobados que ninguna persona corrigió.',
    'Entre los documentos aprobados de la ventana, el porcentaje que no recibió correcciones de una persona. Sin aprobados muestra «—», no 0 %.',
    'Documentos de Carta Porte de tu flota de los últimos días; si hay más de los que se leen de una vez, la pantalla avisa que las cifras son parciales.',
  ),
  'carta_porte_agente.enviados': V(
    'Enviados al sistema del cliente', 'Documentos cuya plantilla ya se envió al sistema del cliente.',
    'Cuenta los envíos de la ventana con estado «enviado». No incluye los subidos a mano.',
    'Envíos de documentos de Carta Porte de tu flota de los últimos días.',
  ),
  'carta_porte_agente.esperan_requerimiento': V(
    'Esperan requerimiento', 'Envíos detenidos porque el requerimiento aún no existe en el sistema del cliente.',
    'Cuenta los envíos de la ventana que siguen pendientes de requerimiento; la nota de abajo da el tiempo del que más espera.',
    'Envíos de documentos de Carta Porte de tu flota de los últimos días.',
    'Revisa con el cliente que el requerimiento se haya dado de alta.',
  ),
  'carta_porte_agente.rechazados_tms': V(
    'Rechazados por el sistema del cliente', 'Envíos que el sistema del cliente rechazó.',
    'Cuenta los envíos de la ventana con estado «rechazado_tms». Las causas conocidas se desglosan en «Por qué se rechazan».',
    'Envíos de documentos de Carta Porte de tu flota de los últimos días.',
    'Corrige la causa y vuelve a enviar.',
  ),
} as const satisfies Record<string, InfoTexto>;
