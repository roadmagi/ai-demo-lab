# Exporting your data

Kestrel gives you three ways to get your data out. All of them are available on
every plan, including Solo, and none of them require contacting support.

## Single project export (CSV)

Open a project, then **Project menu → Export → CSV**. This downloads
immediately, in the browser, with one row per task.

Columns: task ID, title, description, status, assignee email, reporter email,
labels, due date, created date, last updated date, and parent task ID for
subtasks.

Comments and file attachments are **not** included in the CSV export — the
format has nowhere sensible to put them. Use the full workspace export if you
need those.

## Full workspace export (JSON)

**Settings → Data → Export workspace** produces a complete archive of everything
in the workspace:

- Every project, including archived ones
- Every task with its full comment thread and edit history
- All file attachments, as real files in an `attachments/` folder
- Member list and role assignments
- Automation and integration configuration
- Audit log, on plans that have one

The archive is a `.zip` containing newline-delimited JSON files plus the
attachments folder. The JSON schema is documented at
**Settings → Data → Export format**.

Only workspace owners can start a full export. Because it has to gather
attachments, the export is built in the background rather than downloaded
straight away — expect a few minutes for a small workspace and up to a couple of
hours for a large one. We email you a download link when it is ready, and the
same link appears under **Settings → Data → Recent exports**.

Download links expire after **7 days**, at which point you simply run the export
again. There is no limit on how many exports you can run, though only one can be
building at a time per workspace.

## REST API

For anything scheduled or incremental, use the API rather than the export
button. `GET /v1/projects`, `GET /v1/tasks`, and `GET /v1/comments` all support
cursor pagination and an `updated_since` filter, which makes nightly
incremental syncs straightforward. Create a token under
**Settings → Developers**.

API rate limits are on the limits page.

## Exporting after you cancel

Cancelling does not disable exports. A read-only workspace can still run both
the CSV and the full JSON export, and the API still serves `GET` requests.

This matters because of the deletion timeline: a cancelled workspace stays
read-only for 90 days and is then permanently deleted. As long as you export
within that window you lose nothing. After deletion we cannot recover the data
for you — not from backups, and not as a paid recovery service. If you are
cancelling, run a full workspace export first.

## What we do not offer

There is no direct database access, and no way to restore an export back into
Kestrel — imports are a separate feature that reads CSV and Jira/Asana formats,
not our own export archive. If you are moving between two Kestrel workspaces,
contact support and we can move projects across for you.
