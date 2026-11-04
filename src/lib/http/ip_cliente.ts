// ═══════════════════════════════════════════════════════════════════════════
// IP DEL CLIENTE — UNA sola copia (CT-SEG-13; antes había 4 con `split(',')[0]`).
//
// Qué cabecera es de fiar:
//  · `x-vercel-forwarded-for`: la pone el borde de Vercel y SOBRESCRIBE lo que
//    traiga el cliente; es la única que un atacante no puede fijar.
//  · `x-real-ip`: la fija el proxy delante de la app (Vercel también).
//  · `x-forwarded-for`: el cliente puede mandarla ya poblada; el primer valor
//    es el que el atacante elige. Solo se usa como último recurso (local,
//    pruebas) y se toma el valor MÁS A LA DERECHA, el que agregó el proxy más
//    cercano, no el que escribió el cliente.
//
// IPv6: un atacante con una red /64 (lo normal para un hogar o un VPS) tiene
// 2^64 direcciones, y uno con un /56 (la delegacion tipica de un ISP) tiene 256
// /64. Limitar por la direccion completa o por /64 lo deja evadir cualquier tope
// (F1B: 256 /64 de un /56 daban 256 cupos). La llave de limite se normaliza al
// prefijo /56. Costo asumido: usuarios legitimos que comparten un /56 comparten
// cupo; es preferible a un tope que se evade rotando subredes.
// ═══════════════════════════════════════════════════════════════════════════

type Cabeceras = { get(nombre: string): string | null };

/** Quita corchetes, zona (`%eth0`) y puerto de un literal de IP. */
function limpiar(crudo: string): string {
  let v = crudo.trim();
  if (v.startsWith('[')) {
    const fin = v.indexOf(']');
    if (fin > 0) v = v.slice(1, fin);
  } else if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(v)) {
    v = v.slice(0, v.lastIndexOf(':'));
  }
  const zona = v.indexOf('%');
  if (zona >= 0) v = v.slice(0, zona);
  return v.toLowerCase();
}

function esIPv4(v: string): boolean {
  const p = v.split('.');
  return p.length === 4 && p.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255);
}

/** Expande un IPv6 a 8 hextetos de 16 bits o null si no es válido. */
function hextetos(v: string): number[] | null {
  if (!v.includes(':')) return null;
  let texto = v;
  // Cola IPv4 incrustada (::ffff:1.2.3.4) -> dos hextetos.
  const ult = texto.lastIndexOf(':');
  const cola = texto.slice(ult + 1);
  if (cola.includes('.')) {
    if (!esIPv4(cola)) return null;
    const [a, b, c, d] = cola.split('.').map(Number);
    texto = `${texto.slice(0, ult + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const dobles = texto.split('::');
  if (dobles.length > 2) return null;
  const parte = (s: string) => (s === '' ? [] : s.split(':'));
  const izq = parte(dobles[0]);
  const der = dobles.length === 2 ? parte(dobles[1]) : [];
  const faltan = 8 - izq.length - der.length;
  if (dobles.length === 1 ? izq.length !== 8 : faltan < 1) return null;
  const todos = [...izq, ...(dobles.length === 2 ? Array(faltan).fill('0') : []), ...der];
  if (todos.length !== 8) return null;
  const nums = todos.map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

/**
 * Llave estable para limitar por IP: IPv4 tal cual, IPv4 mapeada en IPv6
 * como IPv4, IPv6 reducida a su /56 (`2001:db8:1:200::/56`). Lo que no se
 * reconoce como IP se devuelve intacto (acotado) para no perder la señal.
 */
export function llaveDeIp(crudo: string): string {
  const v = limpiar(crudo);
  if (esIPv4(v)) return v;
  const h = hextetos(v);
  if (!h) return v.slice(0, 64) || 'desconocida';
  // ::ffff:a.b.c.d -> el IPv4 de verdad
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return `${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`;
  }
  return `${[h[0], h[1], h[2], h[3] & 0xff00].map((x) => x.toString(16)).join(':')}::/56`;
}

/**
 * La IP CRUDA (sin normalizar a prefijo) elegida con la regla de confianza de arriba, o null.
 * Es la UNICA copia de la eleccion de cabecera: `seguridad/evento_red.ts` la reutiliza (F1B: tenia
 * su propia copia que tomaba el primer x-forwarded-for, el que escribe el cliente).
 */
export function ipCrudaDeCabeceras(h: Cabeceras): string | null {
  const vercel = h.get('x-vercel-forwarded-for');
  const real = h.get('x-real-ip');
  const xff = h.get('x-forwarded-for');
  const ultimoXff = xff ? xff.split(',').map((s) => s.trim()).filter(Boolean).pop() : undefined;
  const crudo = (vercel ? vercel.split(',')[0] : undefined) || real || ultimoXff;
  return crudo && crudo.trim() ? limpiar(crudo) : null;
}

/** IP del cliente a partir de cabeceras (Request, `headers()` de Next, etc.). */
export function ipDeCabeceras(h: Cabeceras): string {
  const vercel = h.get('x-vercel-forwarded-for');
  const real = h.get('x-real-ip');
  const xff = h.get('x-forwarded-for');
  const ultimoXff = xff ? xff.split(',').map((s) => s.trim()).filter(Boolean).pop() : undefined;
  const crudo = (vercel ? vercel.split(',')[0] : undefined) || real || ultimoXff;
  return crudo && crudo.trim() ? llaveDeIp(crudo) : 'desconocida';
}

export function clientIp(req: Request): string {
  return ipDeCabeceras(req.headers);
}
