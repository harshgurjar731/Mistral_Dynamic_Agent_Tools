import { createFileRoute } from "@tanstack/react-router";
import { AcceptLinkPage } from "@/components/auth/AcceptLinkPage";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({ meta: [{ title: "Accept invitation" }, { name: "robots", content: "noindex" }] }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  return <AcceptLinkPage token={token} expect="invite" />;
}
