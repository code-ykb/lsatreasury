# LSA Treasury: online set-up

The app is a website (GitHub Pages) with its data and logins in Firebase (free Spark plan).

## Who can do what

| Role | Data entry | Reports | People and access | Settings |
|---|---|---|---|---|
| Treasurer | Full | All | Yes, including handing over the Treasurer role | Yes |
| Vice Treasurer | Full | All | Yes, except the Treasurer | Yes |
| Chairperson, Vice Chairperson, Secretary, Vice Secretary, Member | None | Only the reports the Treasurer ticks for that person | No | No |

- Believers do not sign in. They are records (profile and CIF) kept by the Treasurer and Vice Treasurer.
- There is no Super Admin. The first person to complete "First-time set-up" becomes Treasurer. It works once.
- Nobody can change their own role. The Treasurer steps down only by appointing a successor.
- Every change is written to the audit log in the same step, or the database refuses it. Nobody can edit or delete the log.
- Records are never erased: removing one marks it removed.
- Officers see published copies of reports, never the books or Believer details. The Treasurer publishes from the Reports page ("Publish to officers") and can withdraw from Settings.

These rules are enforced by Google's servers (`firebase/firestore.rules`), not by the screens.

## One-off steps (Treasurer)

1. **Firebase project** `lsa-treasury`: Authentication with Email/Password on, Firestore database in Production mode (done).
2. **Add a second Owner**: Project settings, Users and permissions, Add member, role Owner.
3. **Publish the database rules.** Production mode starts with everything blocked, so nothing works until this is done.
   - Open `https://raw.githubusercontent.com/code-ykb/lsatreasury/main/firebase/firestore.rules`, select all and copy.
   - Firebase console, Build, Firestore Database, **Rules** tab, delete what is there, paste, press **Publish**.
   - Repeat this step whenever `firebase/firestore.rules` changes.
4. **First sign-in**: open the app, press "First-time set-up (Treasurer)", and create the Treasurer account straight away. Until someone does, anyone who opens the app first could claim the role.
5. **Add people**: Settings, "Add a person". Each person gets an email from Firebase to choose their own password. Check the email's spam folder the first time.
6. Optional: Authentication, Templates, to put the LSA's name on those emails.

## Monthly

Settings, **Download Excel backup**. Keep the file safe. The free plan has no automatic backups.

## Limits to know

- Free plan: 50,000 reads and 20,000 writes a day. Normal treasury use is far below this.
- Data saved by the earlier browser-only prototype is not carried over.
- Passwords are handled by Firebase. The app never sees them.
- If the Treasurer and Vice Treasurer both lose access, the LSA's Firebase owner can recover through the Firebase console.

## For the developer

- `npm test`: the accounting logic.
- `npm run test:rules`: 30 tests of the access rules against the Firestore emulator.
- `npm run test:e2e`: 61 end-to-end checks of the whole online app against the Auth and Firestore emulators (needs Playwright with Chromium).
- A batch write may trigger at most 20 rule look-ups, so the app saves at most 12 records per batch.
