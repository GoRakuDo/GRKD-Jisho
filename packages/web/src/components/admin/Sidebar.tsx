import React from 'react';
import '../../styles/globals.css';

type SidebarProps = {
  active: string;
};

const ITEMS = [
  { label: 'Dashboard', href: '/admin', slug: 'dashboard' },
  { label: 'Analytics', href: '/admin/analytics', slug: 'analytics' },
  { label: 'Responses', href: '/admin/responses', slug: 'responses' },
  { label: 'Dictionaries', href: '/admin/dictionaries', slug: 'dictionaries' },
  { label: 'Prompts', href: '/admin/prompts', slug: 'prompts' },
  { label: 'Cache', href: '/admin/cache', slug: 'cache' },
  { label: 'Role Settings', href: '/admin/role-settings', slug: 'role-settings' },
  { label: 'Logs', href: '/admin/logs', slug: 'logs' },
  { label: 'Traces', href: '/admin/traces', slug: 'traces' },
  { label: 'Ops Jobs', href: '/admin/ops-jobs', slug: 'ops-jobs' },
];

// Simple inline SVG icons
const NAV_ICONS: Record<string, string> = {
  analytics: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="10" width="3" height="4"/><rect x="6.5" y="6" width="3" height="8"/><rect x="11" y="2" width="3" height="12"/></svg>`,
};

export const Sidebar: React.FC<SidebarProps> = ({ active }) => {
  return (
    <aside className="w-[248px] min-w-[248px] h-full bg-porcelain-100 border-r border-graphite-180 flex flex-col font-grkd-sans">
      <div className="h-16 px-6 flex items-center shrink-0">
        <span className="text-[20px] font-bold text-graphite-800 tracking-[-0.01em]">GRKD</span>
      </div>
      <nav className="flex-1 px-4 py-4 flex flex-col gap-1 overflow-y-auto">
        {ITEMS.map((item) => {
          // A bit of logic to handle 'dashboard' active state since its route is just /admin
          const isActive = active === item.slug || (active === 'admin' && item.slug === 'dashboard');
          const iconSvg = NAV_ICONS[item.slug];
          
          return (
            <a
              key={item.slug}
              href={item.href}
              className={`
                relative flex items-center gap-2.5 px-3 h-10 rounded-button text-[14px] font-medium transition-colors
                ${isActive 
                  ? 'bg-royal-blue-100 text-royal-blue-700' 
                  : 'bg-transparent text-graphite-650 hover:bg-porcelain-150'
                }
              `}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[20px] bg-royal-blue-600 rounded-r-full" />
              )}
              {iconSvg ? (
                <span className="w-4 h-4 flex items-center justify-center shrink-0" dangerouslySetInnerHTML={{ __html: iconSvg }} />
              ) : null}
              {item.label}
            </a>
          );
        })}
      </nav>
    </aside>
  );
};
