export type TasacionItem = {
  id: string;
  address: string;
  value: string;
  status: 'completada' | 'borrador';
};

export const tasacionesRecientes: TasacionItem[] = [
  { id: '1', address: 'Balbin 2346', value: '20M', status: 'completada' },
  { id: '2', address: 'Paroissien 3048', value: '5M', status: 'completada' },
  { id: '3', address: 'Conde 3215', value: '10M', status: 'completada' },
  { id: '4', address: 'Blanco Encalada 2144', value: '20M', status: 'completada' },
];

export const borradores: TasacionItem[] = [
  { id: '5', address: 'Manuel A. Aguirre', value: '50M', status: 'borrador' },
];

export const reporteMock = {
  id: '12345',
  fecha: '30/04/26',
  valorUsd: '20.000',
  valorArs: '25.000.000',
  valorM2Usd: '2.5k',
};
