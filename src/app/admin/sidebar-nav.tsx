'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutGrid, ScanText, Calculator, MessagesSquare, MessageCircle, Sparkles, UserPlus,
  Settings2, FlaskConical, Truck, LineChart, DollarSign, Receipt, TrendingUp, Presentation,
  Server, Blocks, BookOpen, Megaphone, ShieldAlert, ShieldCheck, Users, Settings,
  Activity, ClipboardCheck, Code2, HeartPulse, LifeBuoy, Gauge, ChevronDown,
} from 'lucide-react';

type Item = { href: string; nombre: string; Icono: typeof LayoutGrid };

const AGENTES: Item[] = [
  { href: '/admin/agente-ocr', nombre: 'Agente OCR', Icono: ScanText },
  { href: '/admin/agente-cuadre', nombre: 'Agente de Cuadre', Icono: Calculator },
  { href: '/admin/agente-whatsapp', nombre: 'Agente de WhatsApp', Icono: MessagesSquare },
  { href: '/admin/model-ops', nombre: 'Model Ops', Icono: Settings2 },
  { href: '/admin/playground', nombre: 'Playground', Icono: FlaskConical },
];

const NEGOCIO: Item[] = [
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

const PLATAFORMA: Item[] = [
  { href: '/admin/whatsapp-infra', nombre: 'WhatsApp Infra', Icono: Server },
  { href: '/admin/integraciones', nombre: 'Integraciones', Icono: Blocks },
  { href: '/admin/conocimiento-rag', nombre: 'Conocimiento / RAG', Icono: BookOpen },
  { href: '/admin/comunicacion', nombre: 'Comunicación', Icono: Megaphone },
];

const CONTROL: Item[] = [
  { href: '/admin/trust-safety', nombre: 'Trust & Safety', Icono: ShieldAlert },
  { href: '/admin/compliance', nombre: 'Compliance & Datos', Icono: ShieldCheck },
  { href: '/admin/equipo', nombre: 'Equipo', Icono: Users },
  { href: '/admin/configuracion', nombre: 'Configuración', Icono: Settings },
];

const SISTEMA: Item[] = [
  { href: '/admin/observabilidad', nombre: 'Observabilidad', Icono: Activity },
  { href: '/admin/calidad-evals', nombre: 'Calidad & Evals', Icono: ClipboardCheck },
  { href: '/admin/dev', nombre: 'Dev', Icono: Code2 },
  { href: '/admin/salud-sistema', nombre: 'Salud del sistema', Icono: HeartPulse },
  { href: '/admin/soporte', nombre: 'Soporte', Icono: LifeBuoy },
  { href: '/admin/capacidad-forecast', nombre: 'Capacidad & Forecast', Icono: Gauge },
];

const ITEM = 'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm hover:bg-[color-mix(in_srgb,var(--muted)_10%,transparent)] transition-colors';
const ICONO = { width: 16, height: 16, strokeWidth: 1.75, color: 'var(--muted)' } as const;

/** Una sección plegable — arranca abierta SOLO si la página activa vive
 *  adentro (así no se pierde de dónde viene al cargar), colapsada si no.
 *  Plegar/desplegar es estado de React, no `<details>`: con 6 secciones y
 *  ~29 links no cabían todas abiertas a la vez sin scroll — colapsadas se
 *  ven las 6 categorías de un vistazo, y cada una se abre nada más la que
 *  se necesita. */
function Seccion({ titulo, items }: { titulo: string; items: Item[] }) {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(() => items.some((it) => it.href === pathname));

  return (
    <div>
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="w-full flex items-center justify-between gap-2 px-2.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wide hover:opacity-70 transition-opacity"
        style={{ color: 'var(--muted)' }}
      >
        {titulo}
        <ChevronDown width={12} height={12} strokeWidth={2} className="transition-transform" style={{ transform: abierto ? 'rotate(180deg)' : 'none' }} />
      </button>
      {abierto && items.map(({ href, nombre, Icono }) => (
        <Link key={href} href={href} className={ITEM}>
          <Icono {...ICONO} /> {nombre}
        </Link>
      ))}
    </div>
  );
}

export default function SidebarNav() {
  return (
    <>
      <div>
        <Link href="/admin" className={`${ITEM} font-medium`}>
          <LayoutGrid {...ICONO} /> Inicio
        </Link>
      </div>
      <Seccion titulo="Agentes" items={AGENTES} />
      <Seccion titulo="Negocio" items={NEGOCIO} />
      <Seccion titulo="Plataforma" items={PLATAFORMA} />
      <Seccion titulo="Control" items={CONTROL} />
      <Seccion titulo="Sistema" items={SISTEMA} />
    </>
  );
}
