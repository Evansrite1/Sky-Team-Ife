# Working on the app from your phone (the MCP server)

`api/mcp.js` is an MCP server. Add it to Claude as a custom connector and Claude, on the web or on
your phone, can read and change this app's code, look at and change the database, and check the
deploy. It is the same as working in a coding session, minus a computer: Claude has no shell, cannot
run the app and cannot see the screen. It edits files and talks to GitHub, Vercel and Supabase.

```
Claude (phone)  ->  https://sky-team-ife.vercel.app/mcp  ->  GitHub  (code, commits)
                                                          ->  Supabase (database)
```

## What Claude can do

| Tool | What it does |
|---|---|
| `app_overview` | How the app is built and the rules for changing it |
| `repo_list`, `repo_read`, `repo_search` | Browse, read and search all the code |
| `repo_edit`, `repo_write`, `repo_commit` | Change code. One file, or several as ONE commit |
| `repo_history`, `repo_revert` | See recent commits; undo one |
| `deploy_status` | Is the latest change live? |
| `db_schema`, `db_query` | Look at the live database (read only) |
| `db_execute` | Change the live database. Needs an explicit yes |
| `db_run_file` | Run a SQL file from the repo, such as `supabase/RUN-THIS-ONCE.sql`, instead of pasting it into Supabase |

Safety built in:
* JavaScript and JSON are **syntax-checked before** they are committed, so a typo cannot take the site down.
* A commit containing a secret key (GitHub, Supabase `service_role`, a private key) is refused.
* The service-worker cache (`sw.js`) is bumped automatically when the app files change.
* `db_query` cannot change anything. `db_execute` and `db_run_file` need `confirm: true`; `DROP`,
  `TRUNCATE`, and `DELETE`/`UPDATE` with no `WHERE` need a second `allow_destructive: true`.
* A risky change can go to a branch (Vercel builds a preview, `main` is untouched).
* Everything is a normal Git commit, so `repo_revert` undoes it.

A commit to `main` is live about a minute later. A database change is live the instant it runs.

## One-time setup

You need four things in Vercel and one connector in Claude. About ten minutes.

### 1. A GitHub token (so Claude can read and commit)
GitHub, Settings, Developer settings, Personal access tokens, **Fine-grained tokens**, Generate new token.
* Repository access: **Only select repositories**, then `Sky-Team-Ife`.
* Permissions: **Contents: Read and write**, **Commit statuses: Read**, **Metadata: Read** (automatic).
* Copy the token (starts `github_pat_`). This is `GITHUB_TOKEN`.

### 2. A Supabase access token (so Claude can run SQL)
supabase.com/dashboard, your avatar, **Account, Access Tokens**, Generate new token. Copy it
(starts `sbp_`). This is `SUPABASE_ACCESS_TOKEN`. It is an account token, not the anon or
`service_role` key. It can run SQL on all your Supabase projects, so treat it like a password.

### 3. Add the settings in Vercel
Vercel, the project, **Settings, Environment Variables**. Add these (Production), then **redeploy**:

| Name | Value |
|---|---|
| `MCP_OWNER_PASSWORD` | a password you will type once when connecting (12+ characters) |
| `MCP_SIGNING_SECRET` | long random text (32+ characters). Changing it later signs Claude out everywhere |
| `GITHUB_TOKEN` | the token from step 1 |
| `SUPABASE_ACCESS_TOKEN` | the token from step 2 |
| `MCP_COMMIT_NAME` | the name the commits should be by |
| `MCP_COMMIT_EMAIL` | the email the commits should be by (optional, with the name) |

`CRON_SECRET` is already there; `db_run_file` uses it to fill in the reminder schedule.

### 4. Connect Claude
On **claude.ai** (a computer or the phone's browser): Settings, **Connectors**, **Add custom connector**.
* Name: `Sky Team Ife`
* URL: `https://sky-team-ife.vercel.app/mcp`

Press Connect. A page opens asking for your **owner password**; type it and press Allow. Then
open the Claude app on your phone: the connector is there once it is added to your account.
Switch it on in a chat (the tools icon) and say what you want changed.

Custom connectors need a paid Claude plan (Pro, Max, Team or Enterprise).

## Using it

Start a chat with "Use the Sky Team Ife connector" and ask for a change. For example:
* "Read how the office dashboard is built, then make the projection graph start at 20 orders."
* "Show me the 10 newest reports." (database, read only)
* "Add a column `notes` to reports, then show the form field for it." (database and code)

Claude should say what it is about to change before it does anything to the database. It cannot
test in a browser, so after a change, open the live site and look.

## Turning it off

* Change `MCP_SIGNING_SECRET` in Vercel and redeploy: every sign-in stops working.
* Delete the GitHub and Supabase tokens: the tools stop working even if someone signed in.
* Remove the connector in Claude.

## How it signs in (for the curious)

Claude's connectors use OAuth 2.1 with PKCE. `/register`, `/authorize` and `/token` implement it
without a database: the client id, the authorisation code and the tokens are signed with
`MCP_SIGNING_SECRET`. The only way in is the owner password on the `/authorize` page.
`/mcp` accepts only a valid access token.
