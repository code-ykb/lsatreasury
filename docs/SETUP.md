# LSA Treasury: going online

Status: **step 1 of 3 done** — access rules, audit log and mobile app shell are built and tested.
The screens still save to the browser until step 2 is done. Do not enter real data yet.

## Who can do what

| Role | Data entry | Reports | Manage users | Settings |
|---|---|---|---|---|
| Treasurer | Full | All | Yes, including appointing a new Treasurer | Yes |
| Vice Treasurer | Full | All | Yes, except the Treasurer | Yes |
| Chairperson, Vice Chairperson, Secretary, Vice Secretary, Member | None | Only reports the Treasurer ticks for that person | No | No |

- **Believers do not log in.** They are records (profile and CIF), seen only by the Treasurer and Vice Treasurer.
- **No Super Admin.** The first person to sign in on a new installation becomes Treasurer. This works once only.
- **Nobody can change their own role.** The Treasurer can step down only by appointing a successor in the same step.
- **Audit log.** Every change to users, the books or published reports must be logged in the same step, or the server refuses it. Nobody can edit or delete the log, including the Treasurer.
- **No hard deletes.** Records are marked deleted, never erased.
- **Officers see published reports, not the books.** The Treasurer publishes a report (for example the October balance sheet). Officers see that copy, never the underlying entries or Believer details.

All of the above is enforced on Google's servers by `firebase/firestore.rules` and proven by `npm run test:rules` (27 tests).

## One-off set-up (Treasurer, about 15 minutes)

1. Sign in to Google with the **LSA's own account**, not a personal one.
2. Go to console.firebase.google.com → **Create project** → name it `lsa-treasury`. Turn Google Analytics off.
3. **Build → Authentication → Get started → Email/Password → Enable.**
4. **Build → Firestore Database → Create database → Production mode.** Choose the region nearest Mauritius that is offered. The region cannot be changed later.
5. **Project settings → Users and permissions → Add member.** Add a second trusted person as **Owner**, so the LSA is never locked out.
6. Stay on the free **Spark** plan. Do not add a card.
7. Send the project ID to the developer. Step 2 connects the screens to it.

## Remaining steps

2. Connect the screens to the online database and login; add the user-management screen (create users, tick reports, switch off, hand over Treasurer); add a "Publish report" button and a monthly Excel export.
3. Publish at `https://<project-id>.web.app`, then do the first sign-in as Treasurer straight away.

## Install on a phone

Open the web address. **Android (Chrome):** menu → *Install app*. **iPhone (Safari):** Share → *Add to Home Screen*.
