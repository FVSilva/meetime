import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Phone, CheckSquare,
  Link2, Settings2, MessageCircle, Kanban,
} from 'lucide-react';
import PushBell from './PushBell';

const nav = [
  { to: '/dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/kanban',     label: 'Kanban',     icon: Kanban          },
  { to: '/leads',      label: 'Leads',      icon: Users           },
  { to: '/calls',      label: 'Ligações',   icon: Phone           },
  { to: '/activities', label: 'Atividades', icon: CheckSquare     },
  { divider: true },
  { to: '/whatsapp',   label: 'WhatsApp',   icon: MessageCircle   },
  { to: '/users',      label: 'Usuários',   icon: Settings2       },
  { to: '/webhook',    label: 'Webhook',    icon: Link2           },
];

export default function Sidebar() {
  return (
    <aside className="w-56 bg-black border-r border-gray-900 flex flex-col shrink-0">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-gray-900">
        <div className="flex items-center gap-3">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#dc2626"/>
            <path d="M8 22V10l5.5 8 2.5-4 2.5 4L24 10v12" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div>
            <p className="text-white font-bold text-sm leading-tight">Meetime</p>
            <p className="text-gray-600 text-xs leading-tight">CRM Insights</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map((item, i) =>
          item.divider ? (
            <div key={i} className="border-t border-gray-900 my-2" />
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                  isActive
                    ? 'bg-red-600/10 text-red-400 border-red-600/30'
                    : 'text-gray-500 hover:bg-gray-900 hover:text-gray-200 border-transparent'
                }`
              }
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          )
        )}
      </nav>

      <div className="border-t border-gray-900 pt-3 pb-4">
        <PushBell />
        <p className="text-xs text-gray-700 px-5">v1.0 · Integration</p>
      </div>
    </aside>
  );
}
