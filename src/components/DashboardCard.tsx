import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

interface DashboardCardProps {
  title: string;
  value: string | number;
  description?: string;
  trend?: {
    value: number;
    label: string;
    isPositive: boolean;
  };
  icon: LucideIcon;
  className?: string;
}

export const DashboardCard = ({ title, value, description, trend, icon: Icon, className }: DashboardCardProps) => {
  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white p-6 shadow-sm", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-500">{title}</h3>
        <div className="rounded-md bg-primary-50 p-2 text-primary-600">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      
      <div className="mt-4">
        <p className="text-3xl font-bold text-slate-900">{value}</p>
        
        {trend && (
          <div className="mt-2 flex items-center gap-2">
            <span className={cn(
              "inline-flex items-center text-sm font-medium",
              trend.isPositive ? "text-emerald-600" : "text-red-600"
            )}>
              {trend.isPositive ? '+' : '-'}{Math.abs(trend.value)}%
            </span>
            <span className="text-sm text-slate-500">{trend.label}</span>
          </div>
        )}
        
        {description && !trend && (
          <p className="mt-2 text-sm text-slate-500">{description}</p>
        )}
      </div>
    </div>
  );
};
