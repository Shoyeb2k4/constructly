# Android device acceptance test

Run this on a real phone before the app goes to anyone outside the team. It is
ordered so a failure stops you early rather than after an hour of setup.

**What you need:** an Android phone (API 24+, i.e. Android 7 or newer), the
signed APK, and two accounts in the same company with *different* roles — an
Owner and, say, a Site Supervisor. The second account is not optional: half of
what is worth checking is what the restricted user *cannot* do.

Record the build under test:

```
versionName ____   versionCode ____   device ____   Android ____
```

---

## 1. Install and launch

- [ ] APK installs (allow "install unknown apps" for your file manager once).
- [ ] Icon and label read **Constructly**, not "MainActivity" or "Capacitor".
- [ ] App launches to the sign-in screen, not a white screen.
- [ ] No "unsigned package" or "app not installed" error.

> A white screen almost always means the web assets did not get synced. Check
> `npm run mobile:sync:android` ran before the build.

## 2. Email + password

- [ ] Sign in with the Owner account.
- [ ] Wrong password shows a readable error, not a spinner that never stops.
- [ ] After sign-in you land on the dashboard **with real figures**, not
      skeletons that never resolve and not an error card.
- [ ] Sign out returns to sign-in.
- [ ] Sign back in.

## 3. Google sign-in

This is the flow most likely to break, because it leaves the app and must come
back.

- [ ] Tap Google sign-in. It opens a **system browser / Custom Tab**, not an
      in-app WebView (Google blocks OAuth in embedded WebViews).
- [ ] Pick an account.
- [ ] The browser closes **by itself** and returns to Constructly.
- [ ] You are signed in — not returned to the sign-in screen.

> If the browser lands on a "can't open page" error for
> `in.co.constructly.app://auth/callback`, the redirect URL is not on Supabase's
> allow-list. See "Manual setup" below.

## 4. Session persistence — the one people forget

- [ ] Background the app (Home), wait 30 seconds, reopen → still signed in, no
      re-authentication.
- [ ] **Force-stop** the app (Settings → Apps → Constructly → Force stop),
      reopen → still signed in.
- [ ] Reboot the phone, open the app → still signed in.

> Force-stop is the real test. A session held only in memory survives
> backgrounding but not this.

## 5. Modules — as the Owner

Open each and confirm it shows **real data**, not an empty state or an error:

- [ ] Dashboard — figures match the web app for the same company.
- [ ] Projects — list loads; open one; its tabs load.
- [ ] Labour → Attendance — pick a project and a date; the sheet loads.
- [ ] Labour → Contractors — list loads; open a contractor.
- [ ] Contractor ledger — entries, running balance, and the paid/credited
      totals match the web app for the same contractor.
- [ ] Contractor agreement — open one; scope, rates and milestones load.
- [ ] Vendors — list loads; open one.
- [ ] Procurement — PO list loads; open a PO.
- [ ] Payments — the current period loads; totals match the web app.
- [ ] Reports — hub lists reports; open one; its figures match the web app.
- [ ] Settings — company, profile, users and roles sections load.

> "Matches the web app" is the point. Open the same screen on a laptop
> side-by-side. A number that differs between platforms is a real bug, not a
> rounding artefact — both read the same server function.

## 6. Writing data

- [ ] Mark attendance for one worker, save. It persists after leaving and
      re-entering the screen.
- [ ] Open the same attendance sheet on the **web app** — the entry is there.
- [ ] Record a contractor advance. The ledger and balance both update.
- [ ] Check the web app again — same figures.

## 7. Money formatting

- [ ] Amounts show full Indian figures with Indian digit grouping
      (`₹12,34,567`), not `₹1,234,567` and not `₹12.3L`.
- [ ] An amount with paise keeps them; a whole-rupee amount does not show
      `.00`.
- [ ] No amount wraps mid-number or is cut off on the narrower screen.

## 8. Permissions — as the restricted user

Sign out, sign in as the non-Owner account.

- [ ] Modules that role cannot see are absent from the navigation.
- [ ] Typing/deep-linking into a forbidden module does not render it.
- [ ] Actions that role cannot perform are absent or disabled.
- [ ] Anything that *is* still reachable fails with a clear "not permitted"
      message rather than appearing to succeed.

> Hidden buttons are not security, and this checklist does not treat them as
> such — server-side enforcement is covered by the automated suite. What you are
> checking here is that the app does not *offer* what it will refuse.

## 9. Network loss and recovery

- [ ] Turn on aeroplane mode while a list is open. The app says it is offline;
      it does not crash or show a raw error.
- [ ] With aeroplane mode still on, mark attendance. It is accepted and queued.
- [ ] Turn aeroplane mode off. The queued entry syncs within a few seconds.
- [ ] Confirm on the web app that the entry arrived.
- [ ] Kill the app while offline with a queued entry, reopen, then go online —
      the entry still syncs.

## 10. Navigation and lifecycle

- [ ] The Android **back** button goes back a screen rather than closing the app
      from a detail screen.
- [ ] Back from a top-level screen behaves sensibly (does not trap you).
- [ ] Rotate the phone on a list and a form — no crash, no lost input.
- [ ] Open the keyboard on a form — fields are not hidden behind it.
- [ ] Background the app for 5+ minutes, return — the screen is still there and
      data refreshes rather than showing stale figures forever.

## 11. Files

- [ ] Export a report to Excel → the Android share sheet appears and the file
      opens in a spreadsheet app.
- [ ] Export a report to PDF → same.
- [ ] Export attendance → same.

> On Android a "download" is a share sheet. A silent no-op means an exporter is
> bypassing `saveGeneratedFile`.

## 12. Update behaviour

- [ ] Install a build with a higher `versionCode` over the top. It updates
      **without** uninstalling.
- [ ] You are still signed in after the update.
- [ ] Any queued offline data survived the update.

---

## Manual setup this depends on

These are account-level settings, not code. Google sign-in fails without them.

**Supabase → Authentication → URL Configuration → Redirect URLs** must include:

```
in.co.constructly.app://auth/callback
```

**Google Cloud Console** — the OAuth client used by Supabase must be a **Web
application** client whose authorised redirect URI is Supabase's callback:

```
https://<project-ref>.supabase.co/auth/v1/callback
```

Not an "Android" client, and *not* the custom scheme. Supabase is the broker: it
holds the Google client secret and performs the code exchange, then redirects to
our scheme. Registering the custom scheme with Google would be wrong and would
fail.

`npm run verify:oauth` checks this without a device.

---

## Reporting a failure

For anything that fails, capture:

1. The step number.
2. What you expected and what happened.
3. `adb logcat -s Capacitor:* chromium:*` around the moment it failed.
4. Whether the same action works in the web app for the same account.

Point 4 is the one that matters most: it separates "broken on Android" from
"broken everywhere".
