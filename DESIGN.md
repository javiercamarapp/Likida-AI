# Cuadra — Lenguaje de Diseño

**Dirección:** macOS / Apple premium — elegante, minimalista, profesional. Esto lo va a ver un director ex-Daimler; debe sentirse como software de $100k/año, no como un MVP.

## Principios
1. **Menos es más.** Espacio en blanco generoso. Nada compite por atención. Una acción principal por pantalla.
2. **Jerarquía tipográfica clara.** Un solo tipo (SF Pro / Inter). Pesos: 600 para títulos, 400 para cuerpo, 500 para labels. Números tabulares en tablas y montos.
3. **Color con propósito, no decoración.** Base neutra (grises fríos tipo macOS). Un solo acento. Semáforo solo para estado: verde = cuadra, ámbar = revisar, rojo = diferencia/faltante.
4. **Profundidad sutil.** Sombras suaves y difusas (nunca duras), bordes de 1px `hairline`, esquinas redondeadas 10–14px. Vidrio esmerilado (backdrop-blur) en barras y overlays.
5. **Movimiento discreto.** Transiciones 150–250ms, ease-out. Nada rebota. Skeletons en carga, no spinners agresivos.

## Tokens
```
Fuente:        Inter / SF Pro (system-ui fallback)
Radio:         sm 8px · md 12px · lg 16px
Sombra:        0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06)
Hairline:      1px solid color-mix(in srgb, currentColor 10%, transparent)
Acento:        indigo/teal premium (definir 1)
Fondo claro:   #FBFBFD  ·  Superficie: #FFFFFF
Fondo oscuro:  #0B0B0F  ·  Superficie: #16161C
Estado:        verde #34C759 · ámbar #FF9F0A · rojo #FF3B30  (paleta Apple)
```

## Reglas de UI
- Tablas de liquidación: filas con hairline, montos alineados a la derecha, diferencias en rojo con badge sutil, no gritón.
- Botón primario: sólido acento, uno por vista. Secundarios: `ghost`.
- Sidebar estilo Finder: iconos + label, selección con fondo suave redondeado.
- Modo claro y oscuro desde día uno (respeta `prefers-color-scheme`).
- Componentes: Radix UI + Tailwind, estilizados a mano. Nada de "look Bootstrap".

## Anti-patrones (evitar)
Gradientes chillones · sombras duras · muchos colores · íconos de más · densidad excesiva · "AI slop" (emojis en UI, morados neón, glassmorphism exagerado).
