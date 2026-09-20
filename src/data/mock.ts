export type TasacionItem = {
  id: string;
  address: string;
  value: string;
  status: 'completada' | 'borrador';
  valorUsd?: number | null;
  esAlquiler?: boolean;
};
