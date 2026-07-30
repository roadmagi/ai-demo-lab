# Single sign-on and account security

## Sign-in methods by plan

Kestrel supports three ways to sign in, and which ones you can use depends on
your plan.

**Email and password** is available on every plan. Passwords must be at least 12
characters. We check every new password against a breach corpus and reject ones
that appear in it.

**Social sign-in with Google or Microsoft** is available on every plan,
including Solo. This uses OAuth and requires no configuration — a member just
picks "Continue with Google" or "Continue with Microsoft" on the sign-in screen.

**SAML 2.0 single sign-on is available on the Business plan only.** It is not
included on Solo or Team, and it cannot be added to those plans as a paid
extra. If you are on Team and need SAML, you will need to upgrade the workspace
to Business. Upgrading is prorated, so you are only charged for the difference
for the remainder of your billing period.

We have tested SAML against Okta, Microsoft Entra ID, OneLogin, and JumpCloud.
Any identity provider that supports SAML 2.0 with SP-initiated flow should work,
but those four are the ones we support directly.

## Setting up SAML

SAML configuration lives at **Settings → Security → SAML**. Only workspace
owners can see or change it.

1. In Kestrel, copy the ACS URL and Entity ID shown on the SAML settings page.
2. In your identity provider, create a new SAML application and paste those two
   values in.
3. Copy the IdP metadata URL (or the raw XML) back into Kestrel and save.
4. Use the **Test connection** button before enabling. This runs a full
   round-trip sign-in against your IdP and reports the exact assertion it got
   back, which is far faster than debugging from failed member logins.
5. Once the test passes, toggle **Require SAML for all members**.

While SAML is configured but not yet required, members can use either SAML or
their existing method. Turning on **Require SAML** disables password and social
sign-in for everyone except workspace owners, who keep password access as a
break-glass path so a misconfigured IdP cannot lock you out of your own
workspace.

## SCIM provisioning

SCIM 2.0 user provisioning is also Business-only and is configured on the same
settings page. With SCIM enabled, creating a user in your IdP creates a Kestrel
member, and deactivating them there removes the Kestrel seat automatically on
the next sync. Syncs run every 40 minutes, and can be forced with **Sync now**.

Seat counts update to match your IdP, which means SCIM can change your bill. We
email billing admins whenever a SCIM sync changes the seat count.

## Two-factor authentication

Two-factor authentication is available on all plans and supports authenticator
apps (TOTP) and hardware security keys (WebAuthn). SMS is not supported — it is
meaningfully weaker than the other two and we chose not to offer it.

Workspace owners can require 2FA for all members from **Settings → Security**.
Members who have not yet enrolled are prompted at their next sign-in and given
seven days to complete enrolment before they lose access.

When SAML is required, Kestrel's own 2FA is bypassed, because your identity
provider is responsible for that step.

## Encryption and audit logs

All data is encrypted in transit with TLS 1.3 and at rest with AES-256.

The audit log records sign-ins, permission changes, integration changes, billing
changes, and deletions. It is available on Team and Business. On Team the log
retains 90 days of history; on Business it retains 2 years and can be streamed
to an external SIEM over a webhook. Solo workspaces do not have an audit log.
