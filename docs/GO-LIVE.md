# Go-live checklist (v2)

These are the one-time steps that move the site from the v1 JSON files to the hosted Supabase backend and the dashboard. Do them in order. Until step 6 is done, pushes to `main` keep deploying the v1 content, so nothing breaks while you work.

You need:

- Owner access to the GitHub repo `Echo1560/CesartPortfolio`.
- A local clone of `main` with `npm ci` done (Node 22). Docker is **not** needed for these steps.
- The Supabase CLI through `npx supabase` (it is a dev dependency).
- A password manager for the values you generate. **None of them go into the repo, an issue, a chat or a `.env` file.**

Placeholders below: `<ref>` is the project reference (the `xxxx` in `https://xxxx.supabase.co`), `<anon key>` and `<service role key>` come from the Supabase dashboard (Project Settings → API keys).

## 1. Create the hosted Supabase project (free plan)

1. Sign in at https://supabase.com/dashboard and create an organization on the **Free** plan if there is none.
2. **New project**: name `cesart-portfolio`, a strong database password (save it in the password manager), and the region closest to most visitors.
3. Wait until the project is ready. Note the **Project URL** (`https://<ref>.supabase.co`), the **anon / publishable key** and the **service_role / secret key** (Project Settings → API keys).

The free plan pauses a project after a week without traffic. The keep-alive workflow (step 6) prevents that.

## 2. Apply the migrations

From the repo root. The commands are the same in bash and PowerShell:

```sh
npx supabase login                      # opens the browser once
npx supabase link --project-ref <ref>   # asks for the database password
npx supabase db push                    # applies supabase/migrations/*, in order
```

`db push` applies only the migrations. It does **not** run `supabase/seed.sql`, so the local test accounts (`*@example.com`) never reach the hosted project. Check that the output lists the six `20261025000*` migrations and ends without an error. `npx supabase migration list` should then show them on both the local and remote side.

## 3. Auth settings

In the Supabase dashboard, under **Authentication**:

| Where | Setting | Value |
|---|---|---|
| Sign In / Providers | Allow new users to sign up | **Off** |
| Sign In / Providers → Email | Email provider | **On** (password login needs it) |
| Sign In / Providers → Email | Confirm email | On (default) |
| Sign In / Providers → Email | Secure password change | **On** |
| Sign In / Providers → Email | Email OTP expiration | `86400` (one day, so an invite link survives a night) |
| URL Configuration | Site URL | `https://echo1560.github.io/CesartPortfolio/admin/` |
| URL Configuration | Redirect URLs | `https://echo1560.github.io/CesartPortfolio/admin/` (add `http://localhost:4321/CesartPortfolio/admin/` only if you will test against the hosted project locally) |

These match `supabase/config.toml` (`[auth] enable_signup = false`, `secure_password_change = true`, `additional_redirect_urls`), see `docs/V2-CONTRACTS.md` §9.

**Email sending (required for invites and password resets).** The built-in Supabase mailer only delivers to members of your Supabase organization and only a few emails per hour. Before inviting Cesart, set up custom SMTP under **Authentication → Emails → SMTP Settings** with a free transactional email provider (for example Resend or Brevo): sender address, host, port, user and password from that provider. Then send yourself a test with the **Send password reset** action on your own user (step 8) to confirm delivery.

## 4. Storage bucket

The `media` bucket is created by the migration `20261025000600_storage.sql`, together with its policies, so there is nothing to create by hand. Check it under **Storage**:

- bucket `media` exists and is **private** (not public),
- file size limit **25 MB**,
- allowed MIME types `image/gif, image/png, image/jpeg, image/webp, video/mp4, video/webm`.

If the bucket is missing, step 2 did not finish. Run `npx supabase db push` again and read the error. Do not create the bucket by hand, because the policies expect the exact settings above.

## 5. Edge Function secrets and deploy

Generate two random values (one per line, keep them in the password manager). The commands are the same in bash and PowerShell:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # EVENTS_HASH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # PUBLISH_STATUS_TOKEN
```

Create the GitHub token used by the Publish button:

1. GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token.
2. Name `cesart-publish-dispatch`, resource owner `Echo1560`, expiration: the longest you are comfortable with (put a reminder in your calendar to rotate it).
3. **Repository access: Only select repositories → `Echo1560/CesartPortfolio`.**
4. **Repository permissions: Contents → Read and write.** Nothing else (Metadata: read-only is added automatically). This is the minimum GitHub requires for `POST /repos/{owner}/{repo}/dispatches`. It cannot touch any other repository, and it has no Actions, Pages, Secrets or Administration rights.

Set the secrets and deploy the functions.

macOS / Linux / Git Bash:

```sh
npx supabase secrets set \
  EVENTS_HASH_SECRET=<random 1> \
  PUBLISH_STATUS_TOKEN=<random 2> \
  GITHUB_DISPATCH_TOKEN=<github token>
npx supabase functions deploy           # track, publish, publish-status, invite-editor, remove-editor
npx supabase secrets list               # shows the names (digests only, never the values)
```

PowerShell (the `\` line breaks above do not work there, so the first command is one line):

```powershell
npx supabase secrets set EVENTS_HASH_SECRET=<random 1> PUBLISH_STATUS_TOKEN=<random 2> GITHUB_DISPATCH_TOKEN=<github token>
npx supabase functions deploy           # track, publish, publish-status, invite-editor, remove-editor
npx supabase secrets list               # shows the names (digests only, never the values)
```

Function settings, all read from Supabase secrets:

| Name | Required | Value |
|---|---|---|
| `EVENTS_HASH_SECRET` | yes | random ≥ 32 bytes. `track` answers 500 without it. |
| `GITHUB_DISPATCH_TOKEN` | yes | the fine-grained token above |
| `PUBLISH_STATUS_TOKEN` | yes | random ≥ 32 bytes. The **same** value goes into GitHub in step 6. |
| `ADMIN_REDIRECT_URL` | no | default `https://echo1560.github.io/CesartPortfolio/admin/` (where invite links land). Set it only if the site moves. |
| `GITHUB_REPOSITORY` | no | default `Echo1560/CesartPortfolio`. Set it only if the repo is renamed. |
| `GITHUB_API_URL` | tests only | default `https://api.github.com`. The function tests point it at a mock. **Do not set it on the hosted project.** |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase into every function. Do not set them.

The `track` function only accepts browser requests from these origins (`supabase/functions/_shared/http.ts`): `https://echo1560.github.io`, `http://localhost:4321`, `http://127.0.0.1:4321`. A custom domain later needs a code change there.

## 6. GitHub repo secrets

GitHub → the repo → Settings → Secrets and variables → **Actions** → New repository secret:

| Secret | Value | Used by |
|---|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` | deploy, keep-alive |
| `SUPABASE_ANON_KEY` | the anon / publishable key | deploy (build + dashboard bundle), keep-alive |
| `PUBLISH_STATUS_TOKEN` | the same value as in step 5 | deploy (reports publish progress) |

Do **not** add the service-role key or `GITHUB_DISPATCH_TOKEN` to GitHub. The anon key is public by design: Row Level Security decides what it can read.

Also check Settings → Pages → Source is **GitHub Actions**.

From now on, every deploy builds from Supabase and **fails if nothing is published yet**. Do step 7 before you push or merge anything to `main`.

## 7. Import the content

This copies `content/*.json` and every referenced file in `content/media/` into the hosted project and makes it live. Run it **on your own computer** from the repo root on an up-to-date `main`. The service-role key goes into the shell for this one command only.

macOS / Linux / Git Bash:

```sh
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY='<service role key>' \
  npm run db:import -- --hosted --publish
```

PowerShell:

```powershell
$env:SUPABASE_URL = 'https://<ref>.supabase.co'; $env:SUPABASE_SERVICE_ROLE_KEY = '<service role key>'
npm run db:import -- --hosted --publish
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY, Env:SUPABASE_URL
```

Expected output: `→ HOSTED project …`, the number of files uploaded, the draft counts, `→ publish: stored a succeeded publish run; the imported content is live`, and `✓ import complete`.

**Never** put the service-role key in `.env`, a GitHub secret, a commit, or a chat. It bypasses every access rule. Close the terminal afterwards (or clear the variable, as above).

**Parity check** (`docs/V2-CONTRACTS.md` §8 "Import and parity"). `npm run test:parity` builds both sources and diffs every page, but it only runs against the local stack (CI runs it on every PR, which proves the database → `Content` mapping). For the hosted project, check that it holds exactly the imported content:

1. Run the same import command again. It must print `→ publish: the live snapshot already matches, nothing to do`. That proves the live snapshot equals the imported draft, which is built from `content/` by the same function CI tests.
2. Build from the hosted snapshot with the public key only, exactly as the deploy does:

   macOS / Linux / Git Bash:

   ```sh
   CONTENT_SOURCE=supabase PUBLIC_SUPABASE_URL=https://<ref>.supabase.co PUBLIC_SUPABASE_ANON_KEY='<anon key>' npm run build
   ```

   PowerShell (the last line clears the variables; otherwise every later `npm run build` in that window also builds from Supabase):

   ```powershell
   $env:CONTENT_SOURCE = 'supabase'; $env:PUBLIC_SUPABASE_URL = 'https://<ref>.supabase.co'; $env:PUBLIC_SUPABASE_ANON_KEY = '<anon key>'
   npm run build
   Remove-Item Env:CONTENT_SOURCE, Env:PUBLIC_SUPABASE_URL, Env:PUBLIC_SUPABASE_ANON_KEY
   ```

   It must finish with no `ContentSourceError` (that would mean a missing download or nothing published) and no `ContentError`. The page count must equal a plain `npm run build` (14 pages with the placeholder content).
3. Run `git status`: the build must not have changed any tracked file under `content/`.

## 8. Create the two owner accounts

The dashboard's **Invite an editor** form needs an owner who is already logged in, so the first two accounts (Cesart and Echo 1560, both **owners**) are created here once. Every later editor is invited from the dashboard (see `docs/ADMIN.md`).

For each of the two people:

1. Supabase dashboard → **Authentication → Users → Add user → Send invitation**, with their email address. (The SMTP from step 3 must work.)
2. Right away, before they open the email, open **SQL Editor** and run (change the email and name):

   ```sql
   insert into public.editors (user_id, email, display_name, role)
   select id, email, 'Cesart', 'owner' from auth.users where email = 'cesart@REAL-ADDRESS';
   ```

   It must answer `INSERT 0 1`. Without this row the person can sign in to Auth but the dashboard signs them out again with *"This account does not have dashboard access"*.
3. They open the invite email. The link lands on `/CesartPortfolio/admin/` with **Choose a password**. After saving it they are in the dashboard.

Check under **Accounts** in the dashboard that both people show as **owner · Active**. Then invite a test address from the dashboard's **Invite an editor** form and remove it again, to prove the `invite-editor` and `remove-editor` functions work end to end.

## 9. Verify the live site

1. **Deploy from Supabase:** GitHub → Actions → **Deploy to GitHub Pages** → Run workflow on `main`. It must pass with no *Supabase secrets missing* warning in the **Choose the content source** step (so it built from Supabase), and the bundle secret check must pass.
2. **Public site:** open https://echo1560.github.io/CesartPortfolio/. Same pages as before, animations play, every work opens.
3. **Dashboard:** open https://echo1560.github.io/CesartPortfolio/admin/ and log in. Every page loads without a red error.
4. **Publish round trip:** change one small text (for example the hero subheading), click **Publish**, and watch it go **Queued → Running → Success** in 1–2 minutes. The **Build log** link opens the Actions run. Reload the public site and see the change. Change it back and publish again.
5. **Stats:** visit the public site from a phone and open a work. Within a minute, **Stats** for the last 7 days shows the page views and the work open.
6. **Keep-alive:** Actions → **Keep Supabase alive** → Run workflow. It must pass with `Supabase answered HTTP 200`. It then runs every 3 days on its own.
7. **Private data stays private:** with the public key only, the draft tables must be closed:

   macOS / Linux / Git Bash:

   ```sh
   curl -s "https://<ref>.supabase.co/rest/v1/works?select=id" -H "apikey: <anon key>"
   ```

   PowerShell (type `curl.exe`: in Windows PowerShell, plain `curl` is an alias for `Invoke-WebRequest` and rejects these flags):

   ```powershell
   curl.exe -s "https://<ref>.supabase.co/rest/v1/works?select=id" -H "apikey: <anon key>"
   ```

   The answer must be `permission denied for table works` (HTTP 401). Visitors only ever read the published snapshot.
8. **Password reset:** on the dashboard login, use **Forgot your password?** for your own address. The email arrives and the link opens **Choose a password**.

When all eight pass, the site is live on v2. The `content/*.json` files stay in the repo as the v1 fallback and the source of the test fixtures. From now on, content is edited in the dashboard, not in those files.

## Maintenance

**Updating a live project: migrations first, then functions.** When an update brings new migrations and changed Edge Functions, run `npx supabase db push` before `npx supabase functions deploy` (the same commands in bash and PowerShell). For example, the v3 `track` function sends a page slug that only the new `record_event()` accepts. Deployed first, it would drop every stats event until the migration is applied, and only its logs would show it.

**Delete old stats events.** Stats events pile up in the `events` table, and nothing deletes them on its own. To delete events older than 400 days, open the Supabase dashboard → **SQL Editor** and run:

```sql
select purge_old_events();
```

It answers with the number of rows it deleted. To keep a different window, pass an interval, for example `select purge_old_events('180 days');`. Stats can only show the window you keep, and the dashboard's longest range is 400 days.

The function is service-role only: visitors and dashboard users cannot call it. The SQL editor already runs with those rights, so no key is needed there.

When to run it: once a year is enough at this site's traffic. Run it sooner if **Project Settings → Usage** shows the database nearing the free-plan limit (500 MB).

## If something goes wrong

- **Deploy fails with `Supabase secrets missing`:** a step 6 secret is missing or misspelled.
- **Deploy fails with `get_published_content() answered HTTP …` or `nothing is published`:** the project is paused (restore it in the dashboard) or step 7 was not run.
- **Publish stays on Queued, or fails with an upstream error:** `GITHUB_DISPATCH_TOKEN` is wrong, expired, or lacks *Contents: read and write* on this repo. Make a new token and run `npx supabase secrets set GITHUB_DISPATCH_TOKEN=…` (the same command in bash and PowerShell).
- **Publish stays on Running after the Actions run finished:** `PUBLISH_STATUS_TOKEN` differs between Supabase and GitHub. Set the same value in both places.
- **No invite or reset email:** check the SMTP settings (step 3) and Authentication → Logs.
- **Invite link opens the public site instead of the dashboard:** the Site URL or Redirect URLs in step 3 are wrong.
- **Stats stay at zero:** `EVENTS_HASH_SECRET` is not set (the `track` function logs a 500), or an ad blocker blocked the request in your browser.
