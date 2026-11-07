import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "@/components/landing/LandingPage";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Agentic AI control plane — Welcome" },
      {
        name: "description",
        content:
          "Design, govern and run AI agents and workflows on Mistral — one workspace per team, roles you control.",
      },
    ],
  }),
  component: LandingPage,
});
