import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import AppShell from './components/layout/AppShell';

import OrchestratorChat from './features/chat/OrchestratorChat';
import GeneralChat from './features/chat/GeneralChat';
import AgentStudio from './features/agents/AgentStudio';
import AgentDetail from './features/agents/AgentDetail';
import ToolLifecycle from './features/tools/ToolLifecycle';
import WorkflowDashboard from './features/workflows/WorkflowDashboard';
import ArchivedWorkflows from './features/workflows/ArchivedWorkflows';
import WorkflowPlanner from './features/workflows/WorkflowPlanner';
import WorkflowCreateChooser from './features/workflows/WorkflowCreateChooser';
import WorkflowBuilder from './features/workflows/builder/WorkflowBuilder';
import WorkflowVisualizer from './features/workflows/WorkflowVisualizer';
import WorkflowExecutionPage from './features/workflows/WorkflowExecutionPage';
import ConversationMgr from './features/conversations/ConversationManager';
import McpRegistry from './features/mcp/McpRegistry';
import McpServerDetail from './features/mcp/McpServerDetail';
import HealthDashboard from './features/health/HealthDashboard';
import LibraryManager from './features/libraries/LibraryManager';
import RemoteServerDetail from './features/mcp/RemoteServerDetail';
import ConnectorRegistry from './features/connectors/ConnectorRegistry';
import ConnectorDetail from './features/connectors/ConnectorDetail';
import ConceptBrowser from './features/ontology/ConceptBrowser';

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
      { index: true,                   element: <OrchestratorChat /> },
      { path: 'playground',            element: <GeneralChat /> },
      { path: 'agents',                element: <AgentStudio /> },
      { path: 'agents/:id',            element: <AgentDetail /> },
      { path: 'tools',                 element: <ToolLifecycle /> },
      { path: 'workflows',             element: <WorkflowDashboard /> },
      // /workflows/new forks into the two authoring modes; both land on a
      // WorkflowDefinition that the visual builder can reopen later.
      { path: 'workflows/new',         element: <WorkflowCreateChooser /> },
      { path: 'workflows/new/ai',      element: <WorkflowPlanner /> },
      { path: 'workflows/new/visual',  element: <WorkflowBuilder /> },
      { path: 'workflows/archived',    element: <ArchivedWorkflows /> },
      { path: 'workflows/:workflowName', element: <WorkflowVisualizer /> },
      { path: 'workflows/:workflowName/edit',    element: <WorkflowBuilder /> },
      { path: 'workflows/:workflowName/execute', element: <WorkflowExecutionPage /> },
      { path: 'conversations',         element: <ConversationMgr /> },
      { path: 'ontology',              element: <ConceptBrowser /> },
      { path: 'connectors',            element: <ConnectorRegistry /> },
      { path: 'connectors/:id',        element: <ConnectorDetail /> },
      { path: 'mcp',                   element: <McpRegistry /> },
      { path: 'mcp/:serverName',         element: <McpServerDetail /> },
      { path: 'remote-servers/:id',      element: <RemoteServerDetail /> },
      { path: 'libraries',              element: <LibraryManager /> },
      { path: 'health',                element: <HealthDashboard /> },
      { path: '*',                     element: <NotFound /> },
    ],
  },
]);

import { MotionConfig } from 'framer-motion';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <RouterProvider router={router} />
    </MotionConfig>
  );
}
