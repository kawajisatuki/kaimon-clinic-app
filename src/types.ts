export interface User {
  id: string;
  username: string;
  name: string;
  role: 'student' | 'admin';
}

export interface MenuItem {
  id: string;
  date: string;
  meal_type: 'lunch' | 'dinner';
  title: string;
  description: string;
  calories: number;
  allergens: string;
}

export interface Reservation {
  id: string;
  user_id?: string;
  guest_name?: string;
  menu_id: string;
  status: string;
  date?: string;
  title?: string;
  consumed: boolean;
  meal_type?: 'lunch' | 'dinner';
}
