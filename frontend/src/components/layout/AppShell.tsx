import { NavLink } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { to: '/recruitment', label: 'Recruitment', icon: '📋' },
  { to: '/employees', label: 'Employees', icon: '🧑‍💼' },
  { to: '/ctc-structures', label: 'CTC Structures', icon: '🧮' },
]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuthStore()

  return (
    <div className="min-h-screen bg-gray-950 flex">
      <aside className="w-60 border-r border-gray-800 flex flex-col">
        <div className="px-5 py-6 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500
                          flex items-center justify-center text-white font-bold text-sm">
            iB
          </div>
          <div>
            <div className="text-white font-semibold text-sm leading-tight">HR Portal</div>
            <div className="text-gray-500 text-xs">{user?.role === 'super_user' ? 'Super User' : 'HR'}</div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-pink-500/20 text-white'
                    : 'text-gray-400 hover:bg-gray-900 hover:text-white'
                }`
              }
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}

          {user?.role === 'super_user' && (
            <>
              <NavLink
                to="/letter-templates"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-pink-500/20 text-white'
                      : 'text-gray-400 hover:bg-gray-900 hover:text-white'
                  }`
                }
              >
                <span>🗒️</span>
                Letter Templates
              </NavLink>
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-pink-500/20 text-white'
                      : 'text-gray-400 hover:bg-gray-900 hover:text-white'
                  }`
                }
              >
                <span>⚙️</span>
                Admin
              </NavLink>
            </>
          )}
        </nav>

        <div className="p-3 border-t border-gray-800">
          <div className="px-3 py-2 mb-2">
            <div className="text-white text-sm font-medium truncate">{user?.full_name}</div>
            <div className="text-gray-500 text-xs truncate">{user?.email}</div>
          </div>
          <button
            onClick={signOut}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-400
                       hover:bg-gray-900 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
