import React from 'react';
import '../../styles/globals.css';

type TopBarProps = {
  title: string;
};

export const TopBar: React.FC<TopBarProps> = ({ title }) => {
  return (
    <header className="h-[64px] bg-porcelain-100 border-b border-graphite-180 px-6 flex items-center justify-between font-grkd-sans">
      <div className="flex items-center">
        <h1 className="text-[20px] font-semibold text-graphite-800 tracking-[-0.01em]">
          {title}
        </h1>
      </div>
      <div className="flex items-center gap-4">
        {/* Placeholder for future health chips and user menu */}
        <div className="flex items-center gap-2">
          {/* Mock health chips could go here */}
        </div>
        <div className="w-8 h-8 rounded-full bg-porcelain-220 flex items-center justify-center text-graphite-650 text-sm font-medium">
          {/* User menu placeholder */}
          U
        </div>
      </div>
    </header>
  );
};
