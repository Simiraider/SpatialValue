import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, ...props }, ref) => {
    const esPassword = type === 'password';
    const [visible, setVisible] = React.useState(false);

    return (
      <div className="flex flex-col space-y-1.5 w-full">
        {label && <label className="text-sm font-medium text-inherit ml-1">{label}</label>}
        <div className="relative w-full">
          <input
            type={esPassword && visible ? 'text' : type}
            className={cn(
              "flex h-12 w-full rounded-2xl bg-white px-4 py-2 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-50 border-0",
              esPassword && "pr-12",
              error && "ring-2 ring-red-500 focus-visible:ring-red-500",
              className
            )}
            ref={ref}
            {...props}
          />
          {esPassword && (
            <button
              type="button"
              aria-label={visible ? 'Ocultar contraseña' : 'Ver contraseña'}
              aria-pressed={visible}
              title={visible ? 'Ocultar contraseña' : 'Ver contraseña'}
              onClick={() => setVisible((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 grid place-items-center h-7 w-7 rounded-full text-slate-400 transition-colors hover:text-cyan-600 hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
            >
              {visible ? <EyeOff className="h-[1.1rem] w-[1.1rem]" aria-hidden /> : <Eye className="h-[1.1rem] w-[1.1rem]" aria-hidden />}
            </button>
          )}
        </div>
        {error && <p className="text-sm text-red-500 ml-1">{error}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';
