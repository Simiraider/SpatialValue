export type TasacionItem = {
  id: string;
  address: string;
  value: string;
  status: 'completada' | 'borrador';
};

export const borradores: TasacionItem[] = [
  { id: '5', address: 'Manuel A. Aguirre', value: '50M', status: 'borrador' },
];
