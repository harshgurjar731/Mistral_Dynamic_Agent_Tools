import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useState } from 'react';
import { Menu } from 'lucide-react';

export default function AppShell() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex w-full h-full overflow-hidden vibrant-bg text-[var(--color-text-primary)] font-[family-name:var(--font-display)]">
      <Sidebar mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden relative z-10">
        <div className="md:hidden flex items-center p-4 border-b border-[var(--color-border-subtle)]">
          <button onClick={() => setMobileMenuOpen(true)} className="p-2 -ml-2 text-[var(--color-text-muted)] hover:text-white">
            <Menu size={20} />
          </button>
          <span className="font-bold text-sm tracking-tight text-white ml-2">MISTRAL</span>
        </div>
        <main className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden bg-transparent relative">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
