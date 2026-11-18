import { crearTraductor } from './traducir';
import type { DiccionarioDe } from './catalogo';
import type { TrDe } from './tr_tipos';
import { dashboard_a } from './es/dashboard_a';

// Traductor en español del namespace `dashboard_a`, para componentes y utilidades SÍNCRONOS de /dashboard: la página (async) arma el
// traductor con `getT('dashboard_a')` y lo baja por el parámetro `t`; sin él (pruebas, arneses) el código habla español, igual que antes.
export const trDashboardAEs: TrDe<'dashboard_a'> = crearTraductor<DiccionarioDe<'dashboard_a'>>('es', dashboard_a, dashboard_a).t;
