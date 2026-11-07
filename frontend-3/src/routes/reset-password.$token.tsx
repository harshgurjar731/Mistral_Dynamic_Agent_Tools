import { createFileRoute } from "@tanstack/react-router";
import { AcceptLinkPage } from "@/components/auth/AcceptLinkPage";

export const Route = createFileRoute("/reset-password/$token")({
  head: () => ({ meta: [{ title: "Reset password" }, { name: "robots", content: "noindex" }] }),
  component: ResetPage,
});

function ResetPage() {
  const { token } = Route.useParams();
  return <AcceptLinkPage token={token} expect="reset" />;
}
