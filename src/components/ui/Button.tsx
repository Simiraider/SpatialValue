import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'link';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading,
      fullWidth,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          "inline-flex items-center justify-center rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50 disabled:pointer-events-none drop-shadow-sm",
          {
            "bg-slate-200 text-slate-900 hover:bg-slate-300": variant === 'primary',
            "bg-cyan-500 text-white hover:bg-cyan-600": variant === 'secondary',
            "border border-slate-200 hover:bg-slate-100": variant === 'outline',
            "hover:bg-slate-100 hover:text-slate-900 drop-shadow-none": variant === 'ghost',
            "underline-offset-4 hover:underline text-slate-900 drop-shadow-none": variant === 'link',
            "h-9 px-4 text-sm": size === 'sm',
            "h-11 px-8 text-base": size === 'md',
            "h-14 px-10 text-lg": size === 'lg',
            "h-10 w-10": size === 'icon',
            "w-full": fullWidth,
          },
          className
        )}
        {...props}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
