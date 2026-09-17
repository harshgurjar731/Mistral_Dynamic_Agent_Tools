import { createFileRoute, Outlet } from "@tanstack/react-router";

/** Layout route for /libraries — the list and each library's detail render inside it. */
export const Route = createFileRoute("/libraries")({
  component: LibrariesLayout,
});

function LibrariesLayout() {
  return <Outlet />;
}
