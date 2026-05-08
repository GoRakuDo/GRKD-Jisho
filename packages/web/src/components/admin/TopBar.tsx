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
        {/* Placeholder for future health chips */}
        <div className="flex items-center gap-2">
          {/* Health chips */}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-graphite-800 bg-porcelain-220 px-3 py-1 rounded-full font-medium">
            Account
          </span>
          <a 
            href="/auth/logout" 
            className="text-sm text-royal-blue-600 hover:text-royal-blue-700 transition-colors"
          >
            Logout
          </a>
        </div>
      </div>
    </header>
  );
};
