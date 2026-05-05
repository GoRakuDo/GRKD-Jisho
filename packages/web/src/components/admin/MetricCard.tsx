import React from 'react';
import '../../styles/globals.css';

type MetricCardProps = {
  label: string;
  value: string | number;
  className?: string;
};

export const MetricCard: React.FC<MetricCardProps> = ({ label, value, className = '' }) => {
  return (
    <div className={`bg-porcelain-100 border border-graphite-180 rounded-card p-5 flex flex-col gap-1 font-grkd-sans ${className}`}>
      <span className="text-[13px] font-medium uppercase text-graphite-500 tracking-[0.01em]">
        {label}
      </span>
      <span className="text-[28px] font-semibold text-graphite-900 tracking-[-0.015em] leading-[1.2]">
        {value}
      </span>
    </div>
  );
};
