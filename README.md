# RAC GitHub MCP Server

A Model Context Protocol (MCP) server that connects GitHub Copilot Chat directly to the `rentacenter` GitHub organization. The **racpad support team** can ask plain-English questions about any racpad codebase and get answers backed by the actual source code — no manual searching, no cloning.

---

## Setup

### Prerequisites
- Node.js 18+
- Git installed (required for clone-based tools)
- A GitHub Personal Access Token (PAT) with:
  - `repo` scope (read access to private repos)
  - `read:org` scope
  - **SSO authorized** for the `rentacenter` organization ([authorize here](https://github.com/settings/tokens))

### Installation

```bash
cd github-mcp-server
npm install
```

### Configuration

Create a `.env` file in the project root:

```
GITHUB_TOKEN = ghp_your_token_here
GITHUB_ORG = rentacenter
```

> ⚠️ Never commit `.env` to git. It's in `.gitignore`.

### VS Code MCP Registration

The server is already registered in `.vscode/mcp.json`. VS Code will auto-start it when you open a Copilot Chat session. If prompted, enter your GitHub token.

To restart the server after changes: open Command Palette → **MCP: Restart Server**.

---

## How to Use

Open **GitHub Copilot Chat** (Ctrl+Shift+I) and just ask questions naturally. The AI will call the right tool automatically.

### Repo naming convention

| Module type | Repo prefix | Example |
|-------------|-------------|---------|
| Frontend UI (store app) | `racpad_` | `racpad_agreement` |
| Backend services | `es_` | `es_agreementcreate` |
| Enterprise shared | `ess_` | `ess_ess-common` |
| SIMS (inventory) | `sims_` | `sims_sims` |
| Mariner portal | `mariner_` | `mariner_customerportal` |

---

## Tools Reference

### 🔍 Code Search & Analysis

#### `fetch_issue_context` ⭐ (Primary tool)
**Best for:** "Why does X happen on the Y screen?"

Given a plain-English issue description + optional module name, automatically:
1. Resolves the correct repo (`racpad_<module>`)
2. Extracts keywords from your description
3. Searches GitHub for matching files
4. Returns the 3 most relevant file sections (150 lines each)

**Example prompts:**
- *"Agreement creation fails when customer has no address — which module is this?"* → add `module: agreement`
- *"Payment screen shows 'Something went wrong' on card save"* → add `module: payment`

---

#### `clone_and_search` ⚡ (Fastest for known repos)
**Best for:** Searching for exact function names, conditions, or patterns in a known repo.

Shallow-clones only the folder you care about, runs a local regex search, then deletes the clone. **No rate limits.**

**Example prompts:**
- *"Find where the Transfer button is disabled in racpad_agreement"*
- *"Show all places featureFlagDetails is used in racpad_customer"*

| Parameter | Description |
|-----------|-------------|
| `repo` | e.g. `racpad_agreement` |
| `pattern` | Regex or text, e.g. `disabled.*[Tt]ransfer` |
| `path_filter` | Limit to a subfolder, e.g. `client/src/components/AgreementTransfer` |
| `extensions` | Default: `[".tsx",".ts",".js",".jsx"]` |
| `context_lines` | Lines of context around each match (default 5) |

---

#### `search_code`
**Best for:** Finding which file/repo contains a symbol when you don't know the repo.

Uses GitHub Code Search API. Returns file paths + inline snippets without fetching full files.

> ⚠️ Rate-limited: 10 requests/minute. Use `clone_and_search` for follow-up deep dives.

---

#### `multi_repo_search`
**Best for:** "Is this function used in other racpad repos too?"

Searches across all repos in the org with a given prefix (default `racpad_`).

**Example prompts:**
- *"Where is `useCustomerClub` used across all racpad repos?"*
- *"Which repos reference `EnableClubTransfer` feature flag?"*

---

### 📋 Support Investigation Tools

#### `find_feature_flags`
**Best for:** Understanding what feature flags control a screen's behavior.

Clones the full repo and extracts every unique `featureFlagDetails?.XXX` reference, with the file and line number.

**Example prompt:**
- *"What feature flags are used in racpad_agreement?"*

**Common flags found in racpad:**
| Flag | Effect |
|------|--------|
| `EnableClubTransfer` | Enables auto-transfer of club/benefits membership during agreement transfer |
| `DateTimeLocalization` | Switches date display to locale-aware format |

---

#### `find_error_messages`
**Best for:** "What error messages can appear on this screen?"

Extracts all user-facing strings: i18n `t("...")` calls, error popups, alert messages.

**Example prompts:**
- *"List all error messages on the AgreementTransfer screen"*
- *"What messages can appear in the racpad_payment checkout flow?"*

---

#### `get_api_calls`
**Best for:** "What backend APIs does this screen call?"

Clones the component folder and extracts all API function calls, axios/fetch calls, and endpoint paths.

**Example prompts:**
- *"What APIs does the AgreementTransfer component use?"*
- *"Which backend services does the payment screen depend on?"*

---

### 📜 Change History Tools

#### `get_recent_commits`
**Best for:** "Something broke recently — what changed?"

Returns last N commits with author, date, and message. Can be filtered to commits that touched a specific file or folder.

**Example prompts:**
- *"Show last 10 commits in racpad_agreement"*
- *"What changed in the AgreementTransfer folder in the last 5 commits?"* → add `path: client/src/components/AgreementTransfer`

---

#### `get_commit_diff`
**Best for:** "What exactly changed in that commit?"

Returns the full diff (additions/deletions per file) for a specific commit SHA.

**Example prompt:**
- *"Show me what changed in commit abc1234 in racpad_payment"*

---

#### `get_open_prs`
**Best for:** "Is there already a fix in progress for this bug?"

Lists all open pull requests for a repo sorted by last updated.

**Example prompt:**
- *"Are there any open PRs for racpad_agreement right now?"*

---

### 🗂️ Navigation Tools

#### `resolve_repo`
**Best for:** Confirming a repo exists before deep-diving.

Maps `module name + prefix` → verified GitHub repo. If not found, suggests similar repos.

| Prefix | Use for |
|--------|---------|
| `racpad` | Frontend/UI issues (default) |
| `es` | Backend lambda/service issues |
| `ess` | Shared enterprise services |
| `sims` | SIMS inventory system |

---

#### `get_repo_files`
Lists files in a directory of any repo. Useful for exploring repo structure.

#### `get_file_content`
Fetches the full content of a specific file.

#### `list_org_repos`
Lists all repos in the org. Supports filtering by type.

---

## Common Support Scenarios

### "A button is greyed out / not working"
```
clone_and_search(
  repo: "racpad_<module>",
  pattern: "disabled",
  path_filter: "client/src/components/<ComponentName>"
)
```

### "An error popup appeared — what triggers it?"
```
find_error_messages(
  repo: "racpad_<module>",
  component: "<ComponentFolderName>"
)
```

### "A feature started/stopped working after a deploy"
```
get_recent_commits(
  repo: "racpad_<module>",
  path: "client/src/components/<ComponentName>",
  limit: 10
)
```
Then follow up with `get_commit_diff` on the suspicious SHA.

### "What feature flag controls this behavior?"
```
find_feature_flags(repo: "racpad_<module>")
```

### "Where is this API called from?"
```
clone_and_search(
  repo: "racpad_<module>",
  pattern: "GetAgreementsByCustomerId|PostTransferAgreement"
)
```

### "This issue might be in the backend — which service handles it?"
```
multi_repo_search(
  query: "transferAgreement",
  prefix: "es"
)
```

---

## Rate Limits

| Tool type | Limit |
|-----------|-------|
| `clone_and_search`, `find_feature_flags`, `find_error_messages`, `get_api_calls` | **No limit** (uses git protocol) |
| `get_recent_commits`, `get_commit_diff`, `get_open_prs`, `get_file_content` | 5,000 requests/hour |
| `search_code`, `fetch_issue_context`, `multi_repo_search` | **10 requests/minute** (GitHub Search API) |

**Recommendation:** For any follow-up analysis after finding the right file, always use `clone_and_search` instead of `search_code` to avoid hitting the search rate limit.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Resource protected by organization SAML enforcement` | [Authorize your token for SSO](https://github.com/settings/tokens) → Configure SSO → Authorize `rentacenter` |
| `Bad credentials` | Token expired or revoked. Generate a new one. |
| `git: command not found` | Install Git and ensure it's in PATH |
| `No matching code found` | Try a more specific function/component name, or provide `repo` explicitly |
| Server not appearing in Copilot | Open Command Palette → MCP: Restart Server |
