export interface NavItem {
  label: string;
  href: string;
  icon?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'appraiser' | 'client';
}
