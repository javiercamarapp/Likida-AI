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
      stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"
      role={titulo ? 'img' : undefined} aria-label={titulo} aria-hidden={titulo ? undefined : true}
    >
      {children}
    </svg>
  );
}

const polvo = (
  <g fill="currentColor" stroke="none" opacity=".5">
    <circle cx="10" cy="14" r=".8" /><circle cx="148" cy="12" r=".9" /><circle cx="26" cy="86" r=".7" /><circle cx="140" cy="84" r=".8" />
    <circle cx="80" cy="8" r=".7" /><circle cx="118" cy="90" r=".7" /><circle cx="52" cy="10" r=".6" />
  </g>
);
const nodo = (cx: number, cy: number) => <circle cx={cx} cy={cy} r="2.6" fill="var(--surface, transparent)" />;

/** Desglose de liquidación que sale como correo: renglones finos → sobre. */
function DesgloseCorreo() {
  return (
    <>
      {polvo}
      <circle cx="80" cy="48" r="38" strokeDasharray="1 5" opacity=".6" />
      <rect x="14" y="26" width="44" height="44" rx="4" />
      <path className="rv-trazo" pathLength={1} d="M22 38h28M22 47h28M22 56h16" />
      <path className="rv-trazo rv-trazo--2" pathLength={1} d="M62 48h30" strokeDasharray="1 4" />
      {nodo(62, 48)}{nodo(92, 48)}
      <rect x="98" y="32" width="48" height="32" rx="4" />
      <path className="rv-trazo rv-trazo--3" pathLength={1} d="m99 34 23 16 23-16" />
    </>
  );
}
/** Documento y revisión lado a lado. */
function DocumentoRevision() {
  return (
    <>
      {polvo}
      <rect x="14" y="18" width="46" height="60" rx="4" />
      <path className="rv-trazo" pathLength={1} d="M23 32h28M23 42h28M23 52h16" />
      <rect x="100" y="18" width="46" height="60" rx="4" />
      <path className="rv-trazo rv-trazo--2" pathLength={1} d="M109 32h28M109 42h28M109 52h16" />
      <path className="rv-trazo rv-trazo--2" pathLength={1} d="M64 48h32" strokeDasharray="1 4" />
      {nodo(64, 48)}{nodo(96, 48)}
      <circle cx="133" cy="66" r="7" fill="var(--surface, transparent)" />
      <path className="rv-trazo rv-trazo--3" pathLength={1} d="m129.5 66 2.5 2.5 5-5.5" />
    </>
  );
}
/** Conexión con el sistema de transporte del cliente: dos nodos y una línea viva. */
function ConexionTms() {
  return (
    <>
      {polvo}
      <circle cx="40" cy="48" r="22" strokeDasharray="1 5" opacity=".6" />
      <circle cx="120" cy="48" r="22" strokeDasharray="1 5" opacity=".6" />
      <circle cx="40" cy="48" r="10" />
      <circle cx="120" cy="48" r="10" />
      <path className="rv-trazo" pathLength={1} d="M50 48h60" />
      <circle cx="80" cy="48" r="3" fill="currentColor" stroke="none" />
      <path className="rv-trazo rv-trazo--2" pathLength={1} d="M40 80v-14M120 80v-14" strokeDasharray="1 4" />
    </>
  );
}
/** Bienvenida: una ruta con nodos que asciende. */
function Bienvenida() {
  return (
    <>
      {polvo}
      <path className="rv-trazo" pathLength={1} d="M18 72C42 72 48 52 70 50S104 38 142 22" />
      {nodo(18, 72)}{nodo(70, 50)}{nodo(108, 38)}
      <circle cx="142" cy="22" r="6" />
      <circle cx="142" cy="22" r="2" fill="currentColor" stroke="none" />
      <circle cx="108" cy="38" r="12" strokeDasharray="1 4" opacity=".6" />
    </>
  );
}
/** Listo: aro y palomita. */
function Listo() {
  return (
    <>
      {polvo}
      <circle cx="80" cy="48" r="30" strokeDasharray="1 5" opacity=".6" />
      <circle cx="80" cy="48" r="20" />
      <path className="rv-trazo" pathLength={1} d="m71 49 7 7 13-14" strokeWidth="1.8" />
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
