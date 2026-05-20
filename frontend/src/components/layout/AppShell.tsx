import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useState } from 'react';
import { Menu } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

export default function AppShell() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="flex w-full h-full overflow-hidden vibrant-bg text-[var(--color-text-primary)] font-[family-name:var(--font-display)]">
      <Sidebar mobileMenuOpen={mobileMenuOpen} setMobileMenuOpen={setMobileMenuOpen} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden relative z-10">
        <div className="md:hidden flex items-center p-4 border-b border-[var(--color-border-subtle)] bg-[rgba(11,14,20,0.8)] backdrop-blur-xl z-50">
          <button onClick={() => setMobileMenuOpen(true)} className="p-2 -ml-2 text-[var(--color-text-muted)] hover:text-white">
            <Menu size={20} />
          </button>
          <span className="font-bold text-xl text-white ml-2">Agentic AI Design Patterns</span>
        </div>
        <main className="flex flex-col flex-1 overflow-y-scroll overflow-x-hidden bg-transparent relative z-0">
          {/* Ambient Background Orbs */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none z-[-1]">
             <div className="ambient-orb ambient-orb-primary w-[800px] h-[800px] top-[-200px] right-[-200px]" />
             <div className="ambient-orb ambient-orb-secondary w-[600px] h-[600px] bottom-[-100px] left-[-100px]" />
             <div className="ambient-orb ambient-orb-accent w-[400px] h-[400px] top-[40%] left-[30%]" />
          </div>
          
          <div className="flex-1 flex flex-col w-full h-full relative z-10">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
