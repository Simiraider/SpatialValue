import { apiFetch } from './api';
import { TASA_ARS_USD } from './mercado';

export interface EstadoDolar {
  valor: number;
  fuente: string;
  actualizado: string | null;
}

let estado: EstadoDolar | null = null;
let promesa: Promise<EstadoDolar> | null = null;

const ESTADO_FALLBACK: EstadoDolar = { valor: TASA_ARS_USD, fuente: 'fallback', actualizado: null };

export function dolarActual(): number {
  return estado?.valor ?? TASA_ARS_USD;
}

export function fuenteDolar(): string | null {
  return estado?.fuente ?? null;
}

export async function cargarDolar(): Promise<EstadoDolar> {
  if (estado) return estado;
  if (promesa) return promesa;

  promesa = apiFetch<any>('/Apis/ObtenerDolar', {}, 6000)
    .then(({ ok, data }) => {
      const valor = Number(data?.valor);
      if (ok && Number.isFinite(valor) && valor > 0) {
        estado = { valor, fuente: String(data?.fuente ?? 'desconocida'), actualizado: data?.actualizado ?? null };
      } else {
        estado = ESTADO_FALLBACK;
      }
      return estado;
    })
    .catch(() => ESTADO_FALLBACK)
    .finally(() => { promesa = null; });

  return promesa;
}
