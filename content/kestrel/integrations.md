# Integrations

Kestrel connects to Slack, GitHub, and Google Calendar. All three are available
on every plan.

## Slack

The Slack integration posts project updates into a channel you choose, and lets
members create Kestrel tasks from a Slack message with the `/kestrel` command.

To connect it, go to **Settings → Integrations → Slack** and click **Connect to
Slack**. You will be asked to authorise the Kestrel app in your Slack workspace,
then to pick a default channel. You need to be a Kestrel workspace owner *and*
have permission to install apps in your Slack workspace.

Per-project routing is configured separately: open a project, then **Project
settings → Notifications**, and pick which channel that project posts to. A
project with no channel set falls back to the workspace default channel.

### Slack updates have stopped arriving

This is the most common integration problem we see, and it is almost always one
of four causes. Work through them in this order.

**1. The Kestrel app was removed from your Slack workspace.** A Slack admin
uninstalling the app revokes our token immediately and silently — Kestrel does
not get told why. Check **Settings → Integrations → Slack**; if the status reads
*Disconnected*, this is your cause. Reconnect and the same channel routing is
restored.

**2. The destination channel was archived.** Archiving a channel does not
reassign the projects pointing at it, so those updates have nowhere to go. The
integration status will still read *Connected*, which makes this one easy to
miss. The **Delivery log** on the Slack settings page will show
`channel_not_found` for the affected posts. Point the project at a live channel.

**3. The Kestrel bot was removed from a private channel.** For private channels
the bot has to be an explicit member. If someone removes it, posts to that
channel fail with `not_in_channel` while everything else keeps working. Re-invite
it with `/invite @Kestrel` in that channel.

**4. The member who connected Slack was deactivated in Kestrel.** The Slack token
is bound to the member who authorised it. If that person is deactivated or their
seat is removed, the token stops working within an hour. Reconnect as a current
member — ideally a workspace owner who is not going to leave.

The **Delivery log** on the Slack settings page keeps 7 days of attempts with the
exact error for each one, and is the fastest way to tell these four cases apart.

## GitHub

The GitHub integration links commits and pull requests to Kestrel tasks. Put a
task ID like `KES-412` in a branch name, commit message, or PR title and Kestrel
attaches it to that task automatically.

Connect it from **Settings → Integrations → GitHub**. You can grant access to
all repositories in an organisation or pick specific ones. We only ever request
read access to code metadata — we do not read file contents.

Moving a task to Done when its PR merges is opt-in per project, under **Project
settings → Automation**.

## Google Calendar

The Google Calendar integration puts task due dates on a calendar. It is
one-way: Kestrel writes to Google Calendar, and edits made in Google Calendar do
not flow back into Kestrel.

Each member connects their own calendar from **Your settings → Calendar**, so
this is not a workspace-wide switch. Syncs run every 15 minutes. Deleting the
Kestrel calendar in Google does not disconnect the integration — it will be
recreated at the next sync. To stop it properly, disconnect on the Kestrel side.

## Building your own

Anything not covered above can be built on the REST API. See the limits page for
API rate limits, and **Settings → Developers** to create an API token. Webhooks
for task and project events are configured on the same page.
