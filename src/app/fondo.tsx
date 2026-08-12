// El fondo de los paneles: LISO, `--bg`.
//
// Historia completa, porque este archivo ya dio tres vueltas y la próxima
// sesión no tiene por qué repetirlas:
//
// 1. Primero fue un shader WebGL — nunca se pudo verificar mirando (WebGL no
//    arranca en Chrome headless en esta máquina) y repintaba cada frame.
// 2. Después fue `/images/fondo-naranja.jpg` al 22% de opacidad — de ahí
//    salía el tinte durazno de toda la consola.
// 3. El 12-ago-2026 la dirección visual cambió a "sala de control limpia"
//    (DESIGN.md v3, destilada de las 8 referencias de Desktop/DASHBOARD):
//    lienzo neutro `--bg`, tarjetas blancas, el naranja como acento y no
//    como ambiente. La imagen queda en `public/images/` por si se revierte.
//
// El componente se queda (lo montan los dos chromes) para que el lienzo siga
// teniendo UN dueño: si el fondo vuelve a cambiar, cambia aquí.

export default function Fondo() {
  return (
    <div className="fixed inset-0 pointer-events-none" aria-hidden>
      <div className="absolute inset-0" style={{ background: 'var(--bg)' }} />
    </div>
  );
}
