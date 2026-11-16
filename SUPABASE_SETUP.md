# Supabase Setup — Sign-In & Cloud Sync

ScreenMate's accounts (email + password sign-in, with emailed 6-digit codes for signup
verification and password reset) and watchlist and watch-history sync (the `watch_progress` table) run on Supabase's free tier.
Until you complete these steps (or until the app has loaded the config worker once on this
device), the app works purely from localStorage and the account modal shows "Sign-in unavailable".

## 1. Create the project

1. Sign up at [supabase.com](https://supabase.com) (free) and create a project.
2. From **Project Settings → API**, copy:
   - **Project URL** (e.g. `https://abcdefgh.supabase.co`)
   - **anon / public key**
3. Set both on the `screenmate` Cloudflare worker (**Workers → screenmate → Settings →
   Variables and Secrets**) as `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The app loads them at
   runtime from `/config` — no rebuild needed. See [workers/screenmate/index.js](workers/screenmate/index.js).

> The anon key is safe to ship to clients — all data access is enforced by the
> row-level security policies below. Never put the `service_role` key in the worker:
> `/config` hands its values to clients (to anyone at all with the default `ACCESS=public`).

## 2. Create the tables (SQL Editor → New query → run)

```sql
create table public.watchlist_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id bigint not null,
  media_type text not null check (media_type in ('movie','tv')),
  added_at timestamptz not null default now(),
  primary key (user_id, media_type, media_id)
);

create table public.watch_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id bigint not null,
  media_type text not null check (media_type in ('movie','tv')),
  season int,
  episode int,
  updated_at timestamptz not null default now(),
  primary key (user_id, media_type, media_id)
);

alter table public.watchlist_items enable row level security;
alter table public.watch_progress enable row level security;

create policy "own rows" on public.watchlist_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own rows" on public.watch_progress for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### Account deletion (also run this — required for Google Play)

The app's **Account → Delete account** button calls this function. It deletes only the
caller's own `auth.users` row; their sessions, identities and synced rows are removed by
`on delete cascade`. Without it the button reports that deletion isn't set up yet.

```sql
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
```

> `security definer` lets the function delete from `auth.users`, which signed-in users
> can't touch directly. It only ever uses `auth.uid()` from the caller's token, so it
> can't delete anyone else. Google Play also asks for a **web page** where users can
> request deletion without the app — link it in Play Console → App content → Data safety.

### Profiles (also run this)

Every account has a `worker_url`: the config worker the app uses for that account
(see [workers/screenmate/index.js](workers/screenmate/index.js) and the README's *Player
modes*). New accounts get the `screenmate` worker. Users can read their own row but can't
change it.

Replace the default below with the origin of your own config worker: the same origin as
`CONFIG_URL` in `src/constants.ts`, without `/config`.

```sql
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  worker_url text not null default 'https://screenmate.guptapranav0144.workers.dev'
    check (worker_url like 'https://%'),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Read-only for the user: no insert/update/delete policies
create policy "read own profile" on public.profiles for select
  using (auth.uid() = user_id);

-- Every new account gets a profile with the default worker
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts that existed before this table
insert into public.profiles (user_id) select id from auth.users on conflict do nothing;
```

To move an account to another config worker, run in the SQL Editor (or edit the row in the
Table Editor):

```sql
update public.profiles set worker_url = 'https://<worker>.<account>.workers.dev'
where user_id = '<user uuid>';
```

A running app picks the change up when it returns to the foreground (after 5 minutes) or
within 30 minutes.

## 3. Configure email auth

1. **Authentication → Sign In / Up → Email**: enable the Email provider and turn **Confirm
   email ON** (signups must verify with the emailed code before the account activates).
   Minimum password length: 6 (default) — the app validates the same.
2. **Authentication → Emails → Templates**: the app verifies typed 6-digit codes (links
   don't work inside the Android app), so replace the body of **both** of these templates:

   **Confirm signup:**

```html
<h2>Verify your ScreenMate account</h2>
<p>Enter this code in the app:</p>
<h1>{{ .Token }}</h1>
<p>The code expires in 10 minutes. If you didn't create an account, ignore this email.</p>
```

   **Reset password:**

```html
<h2>Reset your ScreenMate password</h2>
<p>Enter this code in the app:</p>
<h1>{{ .Token }}</h1>
<p>The code expires in 10 minutes. If you didn't request a reset, ignore this email.</p>
```

3. **Authentication → Sign In / Up**: set OTP expiry to 600 seconds (10 min) if not already.

## 4. Plug in Brevo SMTP (required for real users)

Supabase's built-in mailer only sends ~2 emails/hour and **only to your own team's
addresses** — fine for your first tests, useless for anyone else.

1. Create a free [Brevo](https://www.brevo.com) account (300 emails/day free).
2. Verify a sender: **Senders & IPs → Senders → Add a sender** — your Gmail works;
   click the confirmation link Brevo emails you. No domain needed.
3. Get SMTP credentials: **SMTP & API → SMTP** — note the login and generate an SMTP key.
4. In Supabase: **Project Settings → Authentication → SMTP Settings** → enable custom SMTP:
   - Host: `smtp-relay.brevo.com` · Port: `587`
   - Username: your Brevo SMTP login · Password: the SMTP key
   - Sender email: the address you verified in step 2
5. Raise the email rate limit if needed: **Authentication → Rate Limits** (starts at 30/hour
   with custom SMTP).

## 5. Reload the app

No rebuild is needed: the app picks up the worker's new keys at its next config fetch (on
launch, on return to the foreground, or within 30 minutes). Rebuild (`npm run build-next`,
then `npx cap sync android`) only if you changed `src/constants.ts`.

## Free-tier caveats

- **Project pausing**: free Supabase projects pause after ~1 week without API activity;
  restore with one click in the dashboard.
- **Brevo**: 300 emails/day — each OTP request is one email.
- Signing out (or deleting the account) removes the watchlist and watch history from the
  device; the account keeps its synced copy, which comes back on the next sign-in. Before
  signing out, the app uploads any changes that haven't synced yet (including queued
  deletions); if it can't reach the server it refuses to sign out and offers **Sign out
  anyway**, which signs out and discards those changes. A session that ends without the
  user signing out on this device (e.g. the password was changed, or the session was
  revoked or signed out elsewhere) does not clear the device, and neither does **Cancel and
  sign out** in the "Data on this device" dialog (that data isn't the signed-in account's). Deletions made while the
  network is down are queued locally and replayed on the next sync — unless another device
  re-added or updated the item *after* the deletion, in which case the newer action wins.
- Each device remembers which items it last saw on the server (`watchlistSynced`,
  `progressSynced`). An item that was there before and is gone now was deleted on another
  device, so the next sync removes it locally instead of uploading it again. Items added or
  changed on this device and not uploaded yet are kept and uploaded.
- The device remembers which account its data belongs to (`syncAccountId` in localStorage).
  If a *different* account signs in while the device has data, nothing syncs until the
  user picks **Add to my account** (merge, without the old account's queued deletions),
  **Start fresh** (clear the device data), or **Cancel and sign out**. Data saved before
  the first sign-in joins the first account without asking.
