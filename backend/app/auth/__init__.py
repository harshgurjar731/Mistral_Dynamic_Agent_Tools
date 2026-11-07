"""
Accounts, workspaces and role-based access control.

Two kinds of account sign in separately:

* **Platform admins** (``auth_admins``) manage the platform: workspaces, users,
  roles, other admins and the platform-wide Settings. They do not build or run
  anything themselves, so they have no workspace.
* **Users** (``auth_users``) do the work. Each belongs to one or more
  **workspaces**, with a role in each, and works in one of them at a time.

A workspace is a group of users backed by one Mistral API key: every Mistral
call a user makes uses their active workspace's key, so agents, conversations,
libraries and traces land in that Mistral workspace. Everything else — who
may do what — is decided here, locally. Mistral never sees these accounts.

Configuration is read from the environment (``app.auth.config``), never from
the Settings page: a guard the guarded API can change is no guard.
"""
