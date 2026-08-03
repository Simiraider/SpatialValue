import React from 'react';
import { cn } from '../../lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-3xl bg-white text-slate-900 shadow-sm drop-shadow-sm p-6 sm:p-8 w-full max-w-full",
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";
