# Troubleshooting common problems

## I'm not getting email notifications

Check these in order.

**Your notification settings.** Under **Your settings → Notifications**, confirm
the events you expect are switched on. The defaults are deliberately quiet: you
are notified when you are assigned a task, mentioned in a comment, or when a
task you are watching changes status. Everything else is off until you turn it
on.

**Digest mode.** If your account is in daily or weekly digest mode, individual
emails are suppressed and rolled into one summary instead. People often turn
this on and forget. It is the first setting on the same page.

**Your email provider.** Kestrel sends from `notifications@kestrel.example`.
Corporate mail filters sometimes quarantine it. Ask your IT team to allow that
address, and check your spam folder before assuming the emails were never sent.

**Delivery status.** Workspace owners can see per-member delivery status under
**Settings → Notifications → Delivery**. If a member's address has hard-bounced,
we stop sending to it and mark it there. Fixing the address and clicking
**Reset delivery** starts sending again.

## A board has become slow

Board performance is dominated by how many tasks are rendered at once, not by
how many exist in the project.

Start by narrowing the view. A filter that limits the board to the current
sprint, or to open tasks only, usually restores normal speed instantly. Boards
displaying more than about 1,500 cards at once will feel sluggish in any browser.

Large numbers of custom fields also cost more than people expect, since every
one is rendered on every card. If a project has 25 custom fields and you only
show 4 on the card layout, hiding the rest under **Project settings → Card
layout** makes a visible difference.

If a single project is over 20,000 tasks and you have already filtered the view,
archiving completed work is the real fix. Archived tasks stay searchable and
exportable but stop being loaded into the board.

## An import failed partway through

Imports are all-or-nothing per file. If one row fails validation, no rows from
that file are created, so a failed import never leaves you with a half-imported
project to clean up.

The error report names the row number and column for each problem. The three we
see most often:

- **Unrecognised assignee.** The email in the assignee column has to belong to an
  existing member of the workspace. Invite the person first, then re-run.
- **Date format.** Dates must be ISO 8601 (`2026-03-14`). Locale formats like
  `14/03/2026` are rejected because they are ambiguous.
- **Status not in the workflow.** Every value in the status column has to already
  exist in the target project's workflow. Add the missing statuses first.

Fix the file and re-run the same import; there is nothing to undo first.

## I'm stuck in a sign-in loop

A loop where you sign in successfully and land back on the sign-in page is
almost always cookies. Kestrel needs third-party cookies enabled for its own
domain; some privacy extensions block them by default. Try a private window with
extensions disabled to confirm before changing settings.

If your workspace requires SAML, a loop can also mean your identity provider is
returning an assertion that does not match a Kestrel member — most often because
the email in the assertion differs from the email on the Kestrel account.
A workspace owner can use **Test connection** on the SAML settings page to see
the exact assertion being returned.

## A task disappeared

Deleted tasks go to the project trash for 30 days and can be restored from
**Project menu → Trash**. Check there before assuming data loss.

If it is not in the trash, the task was probably moved rather than deleted.
Search by task ID — IDs never change when a task moves between projects, so
searching `KES-412` will find it wherever it went. The task's history shows who
moved it and when.
