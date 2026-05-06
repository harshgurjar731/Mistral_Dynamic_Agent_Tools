import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import AppShell from './components/layout/AppShell';

const OrchestratorChat   = lazy(() => import('./features/chat/OrchestratorChat'));
const GeneralChat        = lazy(() => import('./features/chat/GeneralChat'));
const AgentStudio        = lazy(() => import('./features/agents/AgentStudio'));
const AgentDetail        = lazy(() => import('./features/agents/AgentDetail'));
const ToolLifecycle      = lazy(() => import('./features/tools/ToolLifecycle'));
const WorkflowDashboard  = lazy(() => import('./features/workflows/WorkflowDashboard'));
const ArchivedWorkflows  = lazy(() => import('./features/workflows/ArchivedWorkflows'));
const WorkflowPlanner    = lazy(() => import('./features/workflows/WorkflowPlanner'));
const WorkflowVisualizer = lazy(() => import('./features/workflows/WorkflowVisualizer'));
const ConversationMgr    = lazy(() => import('./features/conversations/ConversationManager'));
const McpRegistry        = lazy(() => import('./features/mcp/McpRegistry'));
const HealthDashboard    = lazy(() => import('./features/health/HealthDashboard'));

function PageSkeleton() {
  return (
    <div className="p-6 space-y-4 animate-[pulseDot_1.5s_ease-in-out_infinite]">
      <div className="h-6 w-48 bg-bg-subtle rounded-md" />
      <div className="h-4 w-64 bg-bg-subtle rounded-md" />
      <div className="h-32 bg-bg-subtle rounded-xl mt-4" />
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-[var(--color-bg-hover)] border border-[var(--color-border-subtle)] flex items-center justify-center mb-4">
        <span className="text-xl font-bold text-[var(--color-text-muted)]">404</span>
      </div>
      <h2 className="text-xl font-semibold text-white mb-2">Page Not Found</h2>
      <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">The page you are looking for does not exist or is under construction.</p>
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true,                   element: <Suspense fallback={<PageSkeleton />}><OrchestratorChat /></Suspense> },
      { path: 'playground',            element: <Suspense fallback={<PageSkeleton />}><GeneralChat /></Suspense> },
      { path: 'agents',                element: <Suspense fallback={<PageSkeleton />}><AgentStudio /></Suspense> },
      { path: 'agents/:id',            element: <Suspense fallback={<PageSkeleton />}><AgentDetail /></Suspense> },
      { path: 'tools',                 element: <Suspense fallback={<PageSkeleton />}><ToolLifecycle /></Suspense> },
      { path: 'workflows',             element: <Suspense fallback={<PageSkeleton />}><WorkflowDashboard /></Suspense> },
      { path: 'workflows/new',         element: <Suspense fallback={<PageSkeleton />}><WorkflowPlanner /></Suspense> },
      { path: 'workflows/archived',    element: <Suspense fallback={<PageSkeleton />}><ArchivedWorkflows /></Suspense> },
      { path: 'workflows/:workflowName', element: <Suspense fallback={<PageSkeleton />}><WorkflowVisualizer /></Suspense> },
      { path: 'conversations',         element: <Suspense fallback={<PageSkeleton />}><ConversationMgr /></Suspense> },
      { path: 'mcp',                   element: <Suspense fallback={<PageSkeleton />}><McpRegistry /></Suspense> },
      { path: 'health',                element: <Suspense fallback={<PageSkeleton />}><HealthDashboard /></Suspense> },
      { path: '*',                     element: <NotFound /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
