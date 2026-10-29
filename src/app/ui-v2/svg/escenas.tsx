import type { ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// ESCENAS SVG PROPIAS (monocromas, currentColor + tokens de tema). Estáticas por
// defecto; con `animada` los trazos se dibujan UNA vez (solo con no-preference).
// Todo el texto de ejemplo es sintético y genérico.
// ═══════════════════════════════════════════════════════════════════════════

export type EscenaId = 'desglose-correo' | 'documento-revision' | 'conexion-tms' | 'bienvenida' | 'listo';

const W = 160;
const H = 96;

function Lienzo({ children, animada, titulo }: { children: ReactNode; animada?: boolean; titulo?: string }) {
  return (
    <svg
      className={animada ? 'rv-escena rv-escena--anima' : 'rv-escena'}
      viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      role={titulo ? 'img' : undefined} aria-label={titulo} aria-hidden={titulo ? undefined : true}
    >
      {children}
    </svg>
  );
}

const relleno = 'color-mix(in srgb, currentColor 8%, var(--surface, transparent))';

/** Desglose de liquidación que sale como correo. */
function DesgloseCorreo() {
  return (
    <>
      <rect x="16" y="20" width="52" height="60" rx="6" fill={relleno} />
      <path className="rv-trazo" pathLength={1} d="M26 34h32M26 44h32M26 54h20M26 64h26" />
      <path className="rv-trazo rv-trazo--2" pathLength={1} d="M74 50h22" />
      <path className="rv-trazo rv-trazo--2" pathLength={1} d="m91 45 6 5-6 5" />
      <rect x="102" y="32" width="44" height="34" rx="5" fill={relleno} />
      <path className="rv-trazo rv-trazo--3" pathLength={1} d="m104 36 20 15 20-15" />
    </>
  );
}
/** Documento y revisión lado a lado. */
function DocumentoRevision() {
  return (
    <>
      <rect x="14" y="16" width="52" height="64" rx="6" fill={relleno} />
      <path className="rv-trazo" pathLength={1} d="M24 30h30M24 40h30M24 50h18" />
      <rect x="94" y="16" width="52" height="64" rx="6" fill={relleno} />
      <path className="rv-trazo rv-trazo--2" pathLength={1} d="M104 30h30M104 40h30M104 50h18" />
      <path className="rv-trazo rv-trazo--3" pathLength={1} d="M72 48h16M84 43l5 5-5 5" />
      <circle cx="132" cy="68" r="8" fill="var(--surface, transparent)" />
      <path className="rv-trazo rv-trazo--3" pathLength={1} d="m128 68 3 3 5-6" />
    </>
  );
}
/** Conexión con el sistema de transporte del cliente. */
function ConexionTms() {
  return (
    <>
      <rect x="14" y="26" width="42" height="44" rx="6" fill={relleno} />
      <path className="rv-trazo" pathLength={1} d="M22 38h26M22 48h26M22 58h14" />
      <rect x="104" y="26" width="42" height="44" rx="6" fill={relleno} />
      <path className="rv-trazo rv-trazo--2" pathLength={1} d="M112 38h26M112 48h26M112 58h14" />
      <path className="rv-trazo rv-trazo--2" pathLength={1} d="M60 48h14" />
      <circle cx="80" cy="48" r="6" fill="var(--surface, transparent)" />
      <path className="rv-trazo rv-trazo--3" pathLength={1} d="M86 48h14" />
    </>
  );
}
/** Bienvenida: tres peldaños. */
function Bienvenida() {
  return (
    <>
      <path className="rv-trazo" pathLength={1} d="M20 76h32V60h28V44h28V28h32" />
      <circle cx="52" cy="60" r="3" fill="currentColor" />
      <circle cx="80" cy="44" r="3" fill="currentColor" />
      <circle cx="108" cy="28" r="3" fill="currentColor" />
      <path className="rv-trazo rv-trazo--3" pathLength={1} d="M136 28v-8m0 0 5 5m-5-5-5 5" />
    </>
  );
}
/** Listo: aro y palomita. */
function Listo() {
  return (
    <>
      <circle cx="80" cy="48" r="26" fill={relleno} />
      <path className="rv-trazo" pathLength={1} d="m68 49 8 8 16-18" strokeWidth="2.4" />
    </>
  );
}

const ESCENAS: Record<EscenaId, () => ReactNode> = {
  'desglose-correo': DesgloseCorreo,
  'documento-revision': DocumentoRevision,
  'conexion-tms': ConexionTms,
  bienvenida: Bienvenida,
  listo: Listo,
};

export function Escena({ id, animada = false, titulo }: { id: EscenaId; animada?: boolean; titulo?: string }) {
  const Cuerpo = ESCENAS[id];
  return <Lienzo animada={animada} titulo={titulo}><Cuerpo /></Lienzo>;
}
