// El fondo de los paneles: la imagen naranja, atenuada.
//
// Sustituye al shader WebGL (`admin/fondo-shader.tsx`) por tres razones que
// aparecieron al intentar verlo:
//
// 1. NUNCA SE PUDO MIRAR. WebGL no arranca en Chrome headless en esta máquina,
//    así que el canvas salía transparente en toda captura. Un fondo que no se
//    puede verificar mirando se aprueba a ciegas, que es justo lo que la regla
//    del repo prohíbe. Hubo que portar el shader a JS para renderizarlo, y
//    solo entonces se vio que se había vuelto una textura de lava marmoleada
//    —el mismo defecto que el comentario del propio archivo ya advertía—.
// 2. Una imagen la ve cualquiera: el navegador headless, un teléfono viejo, un
//    equipo sin GPU. El shader dependía de que la máquina del contralor
//    tuviera WebGL sano.
// 3. 471 KB en caché contra un canvas repintando cada frame. En una laptop de
//    oficina eso es ventilador.
//
// LA ATENUACIÓN VA EN CSS, NO QUEMADA EN EL ARCHIVO. La imagen se queda a
// plena saturación en disco y aquí se le baja la opacidad sobre el color de
// fondo del sistema: subir o bajar la intensidad es cambiar un número, no
// regenerar y reexportar. `OPACIDAD` es la única perilla.

/** Cuánto de la imagen se deja ver sobre `--bg`. A 1.0 el naranja compite con
 *  los paneles y el texto `--muted` deja de leerse sobre el glass. */
const OPACIDAD = 0.22;

export default function Fondo() {
  return (
    <div className="fixed inset-0 pointer-events-none" aria-hidden>
      {/* Base sólida: si la imagen tarda o falla, el panel no aparece sobre
          un vacío blanco puro sin identidad. */}
      <div className="absolute inset-0" style={{ background: 'var(--bg)' }} />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'url(/images/fondo-naranja.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: OPACIDAD,
          // Bajar saturación además de opacidad: solo con opacidad el naranja
          // se aclara pero sigue igual de puro, y compite. Desaturado se lee
          // como material —papel cálido— en vez de como color plano.
          filter: 'saturate(0.7)',
        }}
      />
    </div>
  );
}
