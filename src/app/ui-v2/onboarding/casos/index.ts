import type { CasosGrupo } from './tipos';
import { CASOS_A } from './grupo_a';
import { CASOS_B } from './grupo_b';
import { CASOS_C } from './grupo_c';
import { CASOS_A_EN } from './en/grupo_a';
import { CASOS_B_EN } from './en/grupo_b';
import { CASOS_C_EN } from './en/grupo_c';

// Registro de los casos por pantalla (solo servidor, igual que `pantallas.ts`: el navegador recibe el recorrido ya armado).
export const CASOS: CasosGrupo = { ...CASOS_A, ...CASOS_B, ...CASOS_C };
export const CASOS_EN: CasosGrupo = { ...CASOS_A_EN, ...CASOS_B_EN, ...CASOS_C_EN };
