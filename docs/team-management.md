# Team Management — Admin Guide

Owners can invite teammates, assign roles, and manage access from
**Settings → Security**. Only Owners see and use this screen.

Roles today: **Owner** (full control, incl. team management) and **Project
Manager** (assigned projects only). The system is role-extensible — new roles
can be added later without redesigning the flow.

---

## 1. Invite a team member

1. Go to **Settings → Security**.
2. Under **Invite a member**, enter the person's **email** and pick a **role**.
3. Click **Invite**.

They receive an email invitation. The invite appears under **Pending
invitations** until they accept. Invites expire after **7 days**.

Notes:
- You can't invite an email that's already on your team.
- You can't invite an email that already has an account elsewhere (each email
  maps to one account globally) — ask them to sign in instead, or use another
  address.

## 2. How a Project Manager accepts the invitation

1. They open the invitation email and click the link.
2. They land on the **Accept invitation** page showing the company and role.
3. They enter their **full name** and choose a **password**.
4. Click **Join team** → they're taken straight into the workspace.

Behind the scenes this creates their member account in your company with the
role you chose. The invite is then marked accepted and disappears from the
pending list.

## 3. Resend or cancel an invitation

Under **Pending invitations**:
- **Resend** — sends the invite email again and extends the expiry by 7 days.
- **Cancel** — immediately revokes the invitation and invalidates the existing
  link (the pending account is removed), so it can no longer be accepted.

## 4. Deactivate, reactivate, or remove members

Open the **⋮** menu next to a member:
- **Deactivate** — they keep their account but lose access immediately (they see
  a "deactivated" screen on sign-in). **Reactivate** restores access.
- **Remove** — permanently deletes their account and revokes access. Records
  they created (projects, purchase orders, payments, etc.) are **kept** and
  reassigned to you, so nothing is lost.

Safeguards (enforced server-side):
- You can't remove, deactivate, or demote the **last active Owner** — promote
  someone else to Owner first.
- You can't deactivate or remove **yourself**.

Every action (invite, accept, resend, cancel, role change, deactivate,
reactivate, remove) is written to the **activity log**.

---

## 5. Required Supabase configuration (one-time, by an admin)

Invitations use Supabase Auth. For invite links to work on **any device**
(the invitee usually opens the email on their own device), the **"Invite user"**
email template must use the token-hash confirmation route — the same approach as
password recovery.

**Supabase Dashboard → Authentication → Email Templates → "Invite user" →**
set the confirmation link to:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/accept-invite
```

Also ensure, under **Authentication → URL Configuration**:
- **Site URL** is set to the production URL (e.g. `https://constructly.co.in`).
- **Redirect URLs** allow-list includes `https://<your-domain>/auth/confirm` and
  `https://<your-domain>/accept-invite`.

Template variables used: `{{ .SiteURL }}`, `{{ .TokenHash }}`. The
`type=invite` and `next=/accept-invite` query params are read by the app's
`/auth/confirm` route to verify the invite and forward the user to the accept
page.

> Until this template is configured, invite emails may use the default link and
> not land on the accept page. This is a dashboard setting, not a code change.

Requirements: `SUPABASE_SERVICE_ROLE_KEY` must be set in the server environment
(already used for admin sign-up). It is never exposed to the browser.
