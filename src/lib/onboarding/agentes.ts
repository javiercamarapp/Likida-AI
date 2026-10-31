import type { Recorrido, PasoTour } from '@/app/ui-v2/movimiento/tour/tipos';
import { menuPorPerfil, hrefsDelMenu } from '@/app/dashboard/shell/menu-por-perfil';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { ANCLA_TITULO } from './pantallas';
import { anclaNav, slugDe } from './anclas';
import type { Ilu } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// UN RECORRIDO CORTO POR CADA UNO DE LOS CINCO AGENTES (perfil `cinco_agentes`): qué hace, qué decide el gerente y qué no hace
// el agente. Cuatro pasos y un cierre. Solo lo recibe quien ve la pantalla del agente (`puedeVerRuta` vía el menú).
// ═══════════════════════════════════════════════════════════════════════════

export interface AgenteOnb {
  id: string;
  href: string;
  nombre: string;
  ilu: Ilu;
  hace: string;
  decide: string;
  limite: string;
}

export const AGENTES: readonly AgenteOnb[] = [
  { id: 'liquidacion', href: '/dashboard/agentes/liquidacion', nombre: 'Liquidación', ilu: 'corte',
    hace: 'Arma la liquidación de cada viaje: compara el anticipo con lo comprobado y entrega el desglose por correo.',
    decide: 'Tú firmas lo que el agente no puede cerrar solo y decides qué conceptos retienen el envío.',
    limite: 'No paga ni mueve dinero. Prepara la cuenta; la autorización es de una persona.' },
  { id: 'peajes', href: '/dashboard/agentes/peajes', nombre: 'Peajes', ilu: 'corte',
    hace: 'Cruza el estado de cuenta del TAG o monedero contra los gastos que comprobaron los viajes.',
    decide: 'Tú decides qué cruces se reclaman y subes el estado de cuenta cuando lo tienes.',
    limite: 'Sin el archivo del mes no hay nada que conciliar. No estima casetas que no se cruzaron.' },
  { id: 'carta-porte', href: '/dashboard/agentes/carta-porte', nombre: 'Carta Porte', ilu: 'lista',
    hace: 'Al despachar, pregunta por WhatsApp lo que falta declarar y arma el borrador con su validación.',
    decide: 'Una persona revisa el borrador antes de que salga. Tú decides quién.',
    limite: 'Prepara y valida. Nunca timbra.' },
  { id: 'vigia', href: '/dashboard/agentes/vigia', nombre: 'Servicio al cliente', ilu: 'chat',
    hace: 'Atiende a los clientes de tu flota: clasifica, responde con datos reales y escala lo que lo requiere.',
    decide: 'Tú apruebas los avisos de viaje y atiendes lo que el agente escala a una persona.',
    limite: 'Solo responde con datos que tiene. Lo molesto o sin respuesta sube a una persona.' },
  { id: 'conductores', href: '/dashboard/agentes/conductores', nombre: 'Comunicación con operadores', ilu: 'chat',
    hace: 'Habla con tus operadores por WhatsApp: pide aceptación del viaje, registra hitos y recoge comprobantes.',
    decide: 'Tú defines cuánto insiste, en qué horario y a quién avisa cuando nadie contesta.',
    limite: 'Sin teléfono capturado no puede escribirle a un operador.' },
];

export const idRecorridoAgente = (id: string) => `agente.${id}`;

export function construirRecorridoAgente(agente: AgenteOnb, rol: string, perfil: PerfilTenant | null | undefined): Recorrido | null {
  // Nómina solo ve conteos: no decide nada en los agentes, así que no recibe su recorrido.
  if (perfil !== 'cinco_agentes' || rol === 'nomina') return null;
  const menu = menuPorPerfil(rol, perfil);
  if (!hrefsDelMenu(menu).includes(agente.href)) return null;
  const slug = slugDe(agente.href);
  const base = { pantalla: agente.href, nombrePantalla: agente.nombre, ilu: agente.ilu, grupo: 0 };
  const pasos: PasoTour[] = [
    { ...base, tipo: 'ir', id: `${slug}.ir`, ancla: anclaNav(agente.href), lado: 'derecha', titulo: `Abre ${agente.nombre}`,
      texto: `Haz clic en «${agente.nombre}» en el menú. Si prefieres, pulsa Llévame.`, avance: { tipo: 'accion', evento: 'click' },
      accion: { verbo: 'Aprieta', objetivo: agente.nombre } },
    { ...base, tipo: 'info', id: `${slug}.hace`, ruta: agente.href, ancla: ANCLA_TITULO, lado: 'abajo', titulo: 'Qué hace', texto: agente.hace },
    { ...base, tipo: 'info', id: `${slug}.decide`, ruta: agente.href, ancla: 'pantalla.primer-bloque', lado: 'abajo', titulo: 'Qué decides tú', texto: agente.decide },
    { ...base, tipo: 'info', id: `${slug}.limite`, ruta: agente.href, ancla: ANCLA_TITULO, lado: 'abajo', titulo: 'Qué no hace', texto: agente.limite },
    { tipo: 'cierre', ilu: 'cierre', id: 'cierre', titulo: `Eso es ${agente.nombre}`, texto: 'Repite este recorrido desde la Guía. Los demás agentes tienen el suyo.' },
  ];
  return { id: idRecorridoAgente(agente.id), version: 1, titulo: `Agente: ${agente.nombre}`, pasos, pista: 'agente', modo: 'completo' };
}
