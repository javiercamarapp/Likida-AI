import {
  LayoutGrid, ScanText, Calculator, MessagesSquare, MessageCircle, Sparkles, UserPlus,
  Settings2, FlaskConical, Truck, LineChart, DollarSign, Receipt, TrendingUp, Presentation,
  Server, Blocks, BookOpen, Megaphone, ShieldAlert, ShieldCheck, Users, Settings,
  Activity, ClipboardCheck, Code2, HeartPulse, LifeBuoy, Gauge,
} from 'lucide-react';

/**
 * El mapa de navegación de /admin — plano, SIN 'use client', a propósito:
 * lo consumen tanto Client Components (`sidebar-nav.tsx`,
 * `command-palette.tsx`) como Server Components (`sidebar-nav-iconos.tsx`).
 * Importar una constante desde un archivo 'use client' hacia un Server
 * Component no funciona (`TODAS_LAS_RUTAS.map is not a function` —
 * Next.js la sustituye por una referencia de cliente, no el arreglo real);
 * un módulo plano no tiene ese problema, se ejecuta igual en ambos lados.
 */
export type Item = { href: string; nombre: string; Icono: typeof LayoutGrid };

export const AGENTES: Item[] = [
  { href: '/admin/agente-ocr', nombre: 'Agente OCR', Icono: ScanText },
  { href: '/admin/agente-cuadre', nombre: 'Agente de Cuadre', Icono: Calculator },
  { href: '/admin/agente-whatsapp', nombre: 'Agente de WhatsApp', Icono: MessagesSquare },
  { href: '/admin/model-ops', nombre: 'Model Ops', Icono: Settings2 },
  { href: '/admin/playground', nombre: 'Playground', Icono: FlaskConical },
];

export const NEGOCIO: Item[] = [
  { href: '/admin/flotas', nombre: 'Flotas / Clientes', Icono: Truck },
  { href: '/admin/conversaciones', nombre: 'Conversaciones', Icono: MessageCircle },
  { href: '/admin/analitica', nombre: 'Analítica & Stats', Icono: LineChart },
  { href: '/admin/costos-facturacion', nombre: 'Costos & Facturación', Icono: DollarSign },
  { href: '/admin/cobranza', nombre: 'Cobranza', Icono: Receipt },
  { href: '/admin/crecimiento', nombre: 'Crecimiento', Icono: TrendingUp },
  { href: '/admin/ejecutivo', nombre: 'Ejecutivo / Board', Icono: Presentation },
  { href: '/admin/chat', nombre: 'Chatea con tus Datos', Icono: Sparkles },
  { href: '/admin/usuarios/nuevo', nombre: 'Nuevo usuario', Icono: UserPlus },
];

export const PLATAFORMA: Item[] = [
  { href: '/admin/whatsapp-infra', nombre: 'WhatsApp Infra', Icono: Server },
  { href: '/admin/integraciones', nombre: 'Integraciones', Icono: Blocks },
  { href: '/admin/conocimiento-rag', nombre: 'Conocimiento / RAG', Icono: BookOpen },
  { href: '/admin/comunicacion', nombre: 'Comunicación', Icono: Megaphone },
];

export const CONTROL: Item[] = [
  { href: '/admin/trust-safety', nombre: 'Trust & Safety', Icono: ShieldAlert },
  { href: '/admin/compliance', nombre: 'Compliance & Datos', Icono: ShieldCheck },
  { href: '/admin/equipo', nombre: 'Equipo', Icono: Users },
  { href: '/admin/configuracion', nombre: 'Configuración', Icono: Settings },
];

export const SISTEMA: Item[] = [
  { href: '/admin/observabilidad', nombre: 'Observabilidad', Icono: Activity },
  { href: '/admin/calidad-evals', nombre: 'Calidad & Evals', Icono: ClipboardCheck },
  { href: '/admin/dev', nombre: 'Dev', Icono: Code2 },
  { href: '/admin/salud-sistema', nombre: 'Salud del sistema', Icono: HeartPulse },
  { href: '/admin/soporte', nombre: 'Soporte', Icono: LifeBuoy },
  { href: '/admin/capacidad-forecast', nombre: 'Capacidad & Forecast', Icono: Gauge },
];

/** Lista plana de las 26+1 rutas — la usan `command-palette.tsx` (⌘K) y
 *  `sidebar-nav-iconos.tsx` (rail colapsado). Inicio se agrega aparte
 *  porque no vive en ninguna de las 5 secciones. */
export const TODAS_LAS_RUTAS: Item[] = [
  { href: '/admin', nombre: 'Inicio', Icono: LayoutGrid },
  ...AGENTES, ...NEGOCIO, ...PLATAFORMA, ...CONTROL, ...SISTEMA,
];
