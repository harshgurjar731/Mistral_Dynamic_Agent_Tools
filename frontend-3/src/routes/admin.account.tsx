import { createFileRoute } from "@tanstack/react-router";
import { adminApi, authKeys } from "@/api/auth";
import { PasswordCard, SessionsCard } from "@/components/auth/AccountCards";
import { AdminPage, PageHeader } from "@/components/admin/parts";
import { useAuthSession } from "@/lib/auth";
import { formatRelative } from "@/lib/status";

export const Route = createFileRoute("/admin/account")({
  head: () => ({ meta: [{ title: "Account — Admin console" }] }),
  component: AdminAccountPage,
});

function AdminAccountPage() {
  const { data } = useAuthSession();
  const admin = data?.admin;
  return (
    <AdminPage>
      <PageHeader
        title="Your admin account"
        description={
          admin
            ? `${admin.email} · last sign-in ${formatRelative(admin.last_login_at)} · password changed ${formatRelative(admin.password_changed_at)}`
            : undefined
        }
      />
      <div className="max-w-3xl space-y-6">
        <PasswordCard change={adminApi.changePassword} minLength={12} />
        <SessionsCard
          queryKey={authKeys.admin.sessions()}
          list={adminApi.sessions}
          revoke={adminApi.revokeSession}
        />
      </div>
    </AdminPage>
  );
}
