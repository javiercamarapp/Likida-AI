import { Logo } from '../logo';

// El 403 de la casa, en el MISMO lenguaje que el 404 (orden del 17-ago:
// nada del estilo anterior — logo, display grande y elegante, mucho aire).
// Sin botón de color: llegar aquí es un callejón, no una acción del
// producto, y el acento de la marca se reserva para lo que sí importa.
export default function SinAcceso() {
  return (
    <main
      className="min-h-screen flex flex-col justify-between px-8 py-8 md:px-14 md:py-12"
      style={{ background: 'var(--bg)' }}
    >
      <Logo alto="h-6" className="self-start" />

      <div className="max-w-3xl">
        <p
          className="text-xs font-medium uppercase"
          style={{ color: 'var(--muted)', letterSpacing: '0.14em' }}
        >
          Error 403
        </p>

        <h1
          className="mt-5 font-medium"
          style={{
            fontFamily: 'var(--font-display), system-ui, sans-serif',
            fontSize: 'clamp(38px, 7vw, 82px)',
            lineHeight: 0.98,
            letterSpacing: '-0.042em',
            textWrap: 'balance',
          }}
        >
          Tu cuenta aún no tiene flota
        </h1>

        <p
          className="mt-6 max-w-lg"
          style={{ color: 'var(--muted)', fontSize: 'clamp(16px, 1.5vw, 19px)', lineHeight: 1.55 }}
        >
          Iniciaste sesión, pero esta cuenta no está vinculada a ninguna flota en Likida.
          Pídele a tu administrador que te dé de alta desde su panel.
        </p>
      </div>

      <p className="text-xs" style={{ color: 'var(--faint, var(--muted))' }}>
        Likida · Liquidación de viajes por WhatsApp
      </p>
    </main>
  );
}
