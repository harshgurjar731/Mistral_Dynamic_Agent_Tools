"""
Admin recovery from the server's shell.

    python -m app.auth.cli create-admin --email you@example.com --name "Your Name"
    python -m app.auth.cli list-admins
    python -m app.auth.cli unlock --email you@example.com

``create-admin`` prompts for the password (never pass it on the command line).
For an existing admin it resets the password, re-enables and unlocks the
account and ends its sessions — the way back in when every admin is locked out.
"""

from __future__ import annotations

import argparse
import getpass
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.auth.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    c = sub.add_parser("create-admin", help="create an admin, or reset an existing one")
    c.add_argument("--email", required=True)
    c.add_argument("--name", default="Platform admin")
    sub.add_parser("list-admins")
    u = sub.add_parser("unlock", help="clear a lockout on an admin or user")
    u.add_argument("--email", required=True)
    args = parser.parse_args(argv)

    from app.auth.setup import prepare_auth
    from app.auth import store
    from app.db_setup import prepare_database

    prepare_database(seed_rules=False)
    prepare_auth()

    if args.command == "create-admin":
        password = getpass.getpass("New password (at least 12 characters): ")
        if password != getpass.getpass("Repeat it: "):
            print("The passwords do not match.", file=sys.stderr)
            return 1
        try:
            admin = store.create_admin_with_password(email=args.email, name=args.name,
                                                     password=password)
        except store.AuthError as e:
            print(e.message, file=sys.stderr)
            return 1
        print(f"Admin {admin['email']} is ready. Sign in at /admin/login — you will be asked "
              "to choose a new password.")
        return 0

    if args.command == "list-admins":
        for a in store.list_admins():
            print(f"{a['email']:40} {a['status']:9} {'locked' if a['locked'] else ''}")
        return 0

    if args.command == "unlock":
        from app.auth.models import Admin, User
        from app.database import SessionLocal

        email = args.email.strip().lower()
        with SessionLocal() as db:
            n = 0
            for model in (Admin, User):
                row = db.query(model).filter(model.email == email).first()
                if row is not None:
                    row.failed_logins, row.locked_until = 0, None
                    n += 1
            db.commit()
        print("Unlocked." if n else "No account with that email.")
        return 0 if n else 1
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
