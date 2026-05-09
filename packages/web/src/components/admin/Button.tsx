import React from 'react';
import '../../styles/globals.css';

type ButtonProps = {
  variant: 'primary' | 'secondary' | 'danger';
  children: React.ReactNode;
  onClick?: (() => void) | undefined;
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
  id?: string;
};

export const Button: React.FC<ButtonProps> = ({
  variant,
  children,
  onClick,
  type = 'button',
  disabled = false,
  className = '',
  id,
}) => {
  const baseClasses = 'inline-flex items-center justify-center gap-2 rounded-button px-4 py-2.5 text-[14px] font-semibold font-grkd-sans transition-colors focus:outline-none focus-visible:ring-[3px] focus-visible:ring-royal-blue-100';
  
  const variantClasses = {
    primary: 'bg-royal-blue-600 text-porcelain-50 border border-royal-blue-700 hover:bg-royal-blue-700',
    secondary: 'bg-porcelain-100 text-graphite-800 border border-graphite-300 hover:bg-porcelain-150',
    danger: 'bg-danger-100 text-danger-600 border border-danger-600 hover:bg-danger-100/80',
  };
  
  const disabledClasses = disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer';
  
  return (
    <button
      id={id}
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${variantClasses[variant]} ${disabledClasses} ${className}`}
    >
      {children}
    </button>
  );
};
