export type TaskType = 'mating' | 'light' | 'delivery_early' | 'delivery_main' | 'delivery_induce' | 'medicine' | 'vaccine' | 'weaning' | 'box' | 'custom';

export interface Batch {
  id: string;
  name: string;
  matingDate: string; // YYYY-MM-DD
  createdAt: number;
  uid?: string;
}

export interface Task {
  id: string;
  batchId: string;
  batchName: string;
  title: string;
  date: string; // YYYY-MM-DD
  completed: boolean;
  type: TaskType;
  cycle?: number;
  daysOffset?: number;
  uid?: string;
}

export const TASK_COLORS: Record<TaskType, string> = {
  mating: 'bg-pink-100 text-pink-800 border-pink-200',
  light: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  delivery_early: 'bg-blue-100 text-blue-800 border-blue-200',
  delivery_main: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  delivery_induce: 'bg-red-100 text-red-800 border-red-200',
  medicine: 'bg-purple-100 text-purple-800 border-purple-200',
  vaccine: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  weaning: 'bg-orange-100 text-orange-800 border-orange-200',
  box: 'bg-amber-100 text-amber-800 border-amber-200',
  custom: 'bg-gray-100 text-gray-800 border-gray-200',
};
