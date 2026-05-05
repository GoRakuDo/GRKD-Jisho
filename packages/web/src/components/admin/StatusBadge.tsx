import React from 'react';
import '../../styles/globals.css';

type StatusBadgeProps = {
  status: string;
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const normalizedStatus = status.toLowerCase();
  
  let colors = 'bg-porcelain-150 text-graphite-650'; // default

  switch (normalizedStatus) {
    case 'manual':
      colors = 'bg-royal-blue-100 text-royal-blue-700';
      break;
    case 'approved':
    case 'enabled':
    case 'succeeded':
      colors = 'bg-success-100 text-success-600';
      break;
    case 'pending':
    case 'running':
      colors = 'bg-warning-100 text-warning-600';
      break;
    case 'failed':
    case 'rejected':
    case 'dangerous':
      colors = 'bg-danger-100 text-danger-600';
      break;
    case 'read-only':
    case 'dry-run':
      colors = 'bg-porcelain-150 text-graphite-650';
      break;
    default:
      colors = 'bg-porcelain-150 text-graphite-650';
      break;
  }

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-[12px] font-medium font-grkd-sans ${colors}`}>
      {status}
    </span>
  );
};
