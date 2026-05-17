import React from 'react';
import { Loader2 } from 'lucide-react';
import '../../styles/button.css';

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
    const classes = [
      'Button',
      `Button--${variant}`,
      `Button--${size}`,
      fullWidth && 'Button--full',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button ref={ref} disabled={disabled || isLoading} className={classes} {...props}>
        {isLoading && <Loader2 className="Button-spinner" aria-hidden />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
