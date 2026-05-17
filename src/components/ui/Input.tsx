import React from 'react';
import '../../styles/input.css';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, ...props }, ref) => {
    const fieldClass = ['Input-field', error && 'Input-field--error', className]
      .filter(Boolean)
      .join(' ');

    return React.createElement(
      'div',
      { className: 'Input' },
      label && React.createElement('label', { className: 'Input-label' }, label),
      React.createElement('input', { type, className: fieldClass, ref, ...props }),
      error && React.createElement('p', { className: 'Input-error' }, error)
    );
  }
);
Input.displayName = 'Input';
