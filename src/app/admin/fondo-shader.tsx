'use client';

import { useEffect, useRef } from 'react';

const VERTEX_SRC = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Fondo monocromo animado — reemplaza el JPG estático (bg-admin.jpg) por un
// shader tipo "shadow blending" (referencia: 21st.dev/community/shaders):
// manchas suaves de gris↔negro que se mueven despacio (fbm de ruido simplex
// con el tiempo como offset), más grano procedural encima para el look
// fílmico de la referencia. Sigue siendo blanco/negro/gris — nunca color —
// para no romper la paleta monocromo del resto de la consola.
const FRAGMENT_SRC = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;

vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}

float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
           -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
        + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amp * snoise(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return value;
}

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = uv * vec2(aspect, 1.0);

  float t = u_time * 0.045;

  // Deformación orgánica de baja frecuencia (2 octavas nomás) — la
  // primera versión usaba 5 octavas a frecuencia alta y se veía "marmoleada"
  // en vez de la transición suave y difuminada de la referencia.
  float warp = fbm(p * 0.7 + vec2(t * 0.6, t * 0.35)) * 0.3;

  // Fuente de luz suave, redonda, a la izquierda — deriva despacio.
  vec2 centro = vec2(0.34 + 0.05 * sin(t * 0.8), 0.62 + 0.05 * cos(t * 0.6)) * vec2(aspect, 1.0);
  float d = distance(p + vec2(warp, warp * 0.5), centro);
  float brillo = smoothstep(1.15, 0.0, d);

  // Degradado diagonal general hacia negro a la derecha.
  float diag = uv.x * 1.2 - uv.y * 0.2;
  float base = 1.0 - smoothstep(0.1, 1.2, diag + warp * 0.5);

  float gray = clamp(max(brillo, base * 0.65), 0.0, 1.0);

  // Grano fílmico — más visible que la primera pasada (0.05 → 0.09),
  // el look "referencia" tiene grano bien presente, no sutil.
  float grain = (rand(gl_FragCoord.xy + u_time * 60.0) - 0.5) * 0.09;
  gray = clamp(gray + grain, 0.0, 1.0);

  // La paleta pasó a blanco + naranja, así que el fondo deja de ser gris.
  // gray se sigue calculando igual —es la FORMA (la nube, el degradado, el
  // grano)— y solo se mapea al final sobre una rampa de naranja: la luz sube
  // hacia crema y la sombra baja a naranja quemado, nunca a negro. Teñir aquí
  // y no en el cálculo mantiene intacto el look fílmico de la referencia.
  vec3 sombra = vec3(0.180, 0.063, 0.020);
  vec3 luz    = vec3(0.996, 0.933, 0.867);
  gl_FragColor = vec4(mix(sombra, luz, gray), 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  return shader;
}

export default function FondoShader() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl');
    if (!gl) return;

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SRC));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC));
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const resLoc = gl.getUniformLocation(program, 'u_resolution');
    const timeLoc = gl.getUniformLocation(program, 'u_time');

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.floor(window.innerWidth * dpr);
      const h = Math.floor(window.innerHeight * dpr);
      if (canvas!.width !== w || canvas!.height !== h) {
        canvas!.width = w;
        canvas!.height = h;
        gl!.viewport(0, 0, w, h);
      }
    }
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    const t0 = performance.now();
    function frame(now: number) {
      resize();
      gl!.uniform2f(resLoc, canvas!.width, canvas!.height);
      gl!.uniform1f(timeLoc, (now - t0) / 1000);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  // SIN z-index negativo a propósito: un z-index negativo pinta DEBAJO del
  // fondo propio de `html`/`body` (`background: var(--bg)` en globals.css)
  // porque ese fondo se pinta al nivel "raíz" del stacking context, por
  // encima de cualquier descendiente con z-index negativo — el canvas
  // quedaba invisible aunque el shader corriera perfecto. z-index 0 (el
  // default) + el contenido real con `position: relative` (ver layout.tsx)
  // alcanza para que el contenido quede encima sin necesitar negativos.
  // `pointer-events-none`: el canvas es DECORATIVO (`aria-hidden`) pero cubre
  // el viewport entero, así que sin esto se queda con cualquier clic que caiga
  // donde el contenido no lo tape. El contenido va en z-10 y normalmente gana,
  // pero eso depende de que cada capa de arriba mantenga su stacking context —
  // una condición que se rompe sola con el tiempo. Un fondo no debe poder
  // recibir un clic en ningún caso.
  return <canvas ref={ref} className="fixed inset-0 w-full h-full pointer-events-none" aria-hidden />;
}
