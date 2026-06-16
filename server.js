import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import dotenv from "dotenv";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

dotenv.config();

if (!process.env.GITHUB_TOKEN) {
  console.error("❌ Missing GITHUB_TOKEN in .env");
  process.exit(1);
}

const DEFAULT_ORG = process.env.GITHUB_ORG || "rentacenter";

const server = new McpServer({
  name: "github-analysis-server",
  version: "3.0.0",
});

const github = axios.create({
  baseURL: "https://api.github.com",
  headers: {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github.v3+json",
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns up to maxLines lines centred around the first line containing
 * keyword. Adds omission comments when the file is truncated.
 */
function truncateToRelevantSection(content, keyword, maxLines = 150) {
  const lines = content.split("\n");
  if (lines.length <= maxLines) return content;

  const lower = keyword.toLowerCase();
  let match = lines.findIndex((l) => l.toLowerCase().includes(lower));
  if (match === -1) match = 0;

  const start = Math.max(0, match - Math.floor(maxLines / 2));
  const end = Math.min(lines.length, start + maxLines);

  return (
    (start > 0 ? `// ... lines 1–${start} omitted ...\n` : "") +
    lines.slice(start, end).join("\n") +
    (end < lines.length ? `\n// ... lines ${end + 1}–${lines.length} omitted ...` : "")
  );
}

/**
 * Extracts up to maxKeywords meaningful words from a natural-language string.
 */
function extractKeywords(text, maxKeywords = 6) {
  const stop = new Set([
    "the","a","an","is","in","on","at","to","for","of","and","or","not",
    "it","this","that","when","how","why","what","where","with","from",
    "are","was","were","been","have","has","had","will","would","could",
    "should","does","did","do","my","we","our","their","its","which","then",
    "also","after","before","about","because","since","while","into","onto",
  ]);
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !stop.has(w))
    ),
  ].slice(0, maxKeywords);
}


// ─── Tool 1: List repo files ──────────────────────────────────────────────────
server.tool(
  "get_repo_files",
  {
    owner: z.string(),
    repo: z.string(),
    path: z.string().optional(),
  },
  async ({ owner, repo, path = "" }) => {
    try {
      const res = await github.get(`/repos/${owner}/${repo}/contents/${path}`);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(
            res.data.map((f) => ({ name: f.name, path: f.path, type: f.type })),
            null, 2
          ),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool 2: Get file content ─────────────────────────────────────────────────
server.tool(
  "get_file_content",
  {
    owner: z.string(),
    repo: z.string(),
    path: z.string(),
  },
  async ({ owner, repo, path }) => {
    try {
      const res = await github.get(`/repos/${owner}/${repo}/contents/${path}`);
      const content = Buffer.from(res.data.content, "base64").toString();
      return { content: [{ type: "text", text: content }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool 3: Analyze code snippet ─────────────────────────────────────────────
server.tool(
  "analyze_code",
  { code: z.string() },
  async ({ code }) => {
    const issues = [];
    const suggestions = [];
    if (code.includes("console.log"))  { issues.push("Contains console.log statements"); suggestions.push("Remove debug logs for production"); }
    if (code.length > 3000)            { issues.push("File too large"); suggestions.push("Break into smaller modules"); }
    if (code.includes("var "))         { issues.push("Uses 'var' instead of let/const"); suggestions.push("Use modern JS syntax"); }
    return {
      content: [{ type: "text", text: JSON.stringify({ status: "Analysis complete", issues, suggestions }, null, 2) }],
    };
  }
);

// ─── Tool 4: Analyze repo summary ─────────────────────────────────────────────
server.tool(
  "analyze_repo",
  { owner: z.string(), repo: z.string() },
  async ({ owner, repo }) => {
    try {
      const res = await github.get(`/repos/${owner}/${repo}/contents`);
      const jsFiles = res.data.filter((f) => f.name.endsWith(".js"));
      return {
        content: [{ type: "text", text: JSON.stringify({ totalFiles: res.data.length, jsFiles: jsFiles.map((f) => f.name) }, null, 2) }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool 5: List org repos ────────────────────────────────────────────────────
server.tool(
  "list_org_repos",
  {
    org: z.string(),
    per_page: z.number().optional(),
  },
  async ({ org, per_page = 100 }) => {
    try {
      let repos = [];
      let page = 1;
      while (true) {
        const res = await github.get(`/orgs/${org}/repos`, { params: { per_page, page, type: "all" } });
        repos = repos.concat(res.data);
        if (res.data.length < per_page) break;
        page++;
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total: repos.length,
            repos: repos.map((r) => ({
              name: r.name,
              private: r.private,
              description: r.description,
              url: r.html_url,
              language: r.language,
              updated_at: r.updated_at,
            })),
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool 6: Resolve module → repo name ───────────────────────────────────────
//
// Prefix guide (rentacenter org):
//   racpad   – frontend / store-management UI (React/Angular)
//   es       – backend enterprise services (Node/Java lambdas)
//   ess      – enterprise shared services
//   sims     – SIMS store inventory management system
//   mariner  – Mariner customer portal
//   van      – VAN engagement services
//   rac-ecom – eCommerce / SSO
//   security – Akamai / security configs
server.tool(
  "resolve_repo",
  {
    module: z.string().describe("Module or feature name, e.g. 'agreement', 'payment', 'customer'"),
    prefix: z
      .enum(["racpad", "es", "ess", "sims", "mariner", "van", "rac-devops", "rac-ecom", "security"])
      .optional()
      .describe("Repo prefix. 'racpad' = frontend/UI, 'es' = backend services. Defaults to 'racpad'."),
    org: z.string().optional().describe("GitHub org. Defaults to rentacenter."),
  },
  async ({ module, prefix = "racpad", org = DEFAULT_ORG }) => {
    const moduleName = module.toLowerCase().replace(/\s+/g, "-");
    const repoName = `${prefix}_${moduleName}`;
    try {
      const res = await github.get(`/repos/${org}/${repoName}`);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            repo: repoName,
            full_name: res.data.full_name,
            exists: true,
            description: res.data.description,
            language: res.data.language,
            default_branch: res.data.default_branch,
            url: res.data.html_url,
          }, null, 2),
        }],
      };
    } catch {
      try {
        const searchRes = await github.get("/search/repositories", {
          params: { q: `${moduleName} org:${org}`, per_page: 5 },
        });
        const suggestions = searchRes.data.items.map((r) => r.name);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              repo: repoName,
              exists: false,
              suggestions,
              message: `'${repoName}' not found. Similar repos: ${suggestions.join(", ")}`,
            }, null, 2),
          }],
        };
      } catch (err2) {
        return { content: [{ type: "text", text: `Error: ${err2.message}` }], isError: true };
      }
    }
  }
);

// ─── Tool 7: Search code ───────────────────────────────────────────────────────
//
// Uses GitHub Code Search to find files matching a query.
// Returns file paths + inline snippets — no full file fetch, very token-efficient.
// Use this to locate where a function/component/variable lives before fetching it.
server.tool(
  "search_code",
  {
    query: z.string().describe("Keywords to search, e.g. 'createAgreement', 'handlePayment', 'CustomerService'"),
    repo: z.string().optional().describe("Repo name, e.g. 'racpad_agreement'. Searches full org when omitted."),
    org: z.string().optional().describe("GitHub org. Defaults to rentacenter."),
    language: z.string().optional().describe("Language filter, e.g. 'typescript', 'javascript'"),
    max_results: z.number().optional().describe("Max results (default 5, max 10)"),
  },
  async ({ query, repo, org = DEFAULT_ORG, language, max_results = 5 }) => {
    try {
      let q = query;
      if (repo) q += ` repo:${org}/${repo}`;
      else q += ` org:${org}`;
      if (language) q += ` language:${language}`;

      const res = await github.get("/search/code", {
        params: { q, per_page: Math.min(max_results, 10) },
        headers: { Accept: "application/vnd.github.v3.text-match+json" },
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total_found: res.data.total_count,
            results: res.data.items.map((item) => ({
              repo: item.repository.name,
              path: item.path,
              url: item.html_url,
              snippets: (item.text_matches || []).map((m) => m.fragment.trim()),
            })),
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool 8: Fetch issue context (PRIMARY analysis tool) ──────────────────────
//
// Given a natural-language issue description, this tool:
//   1. Resolves the target repo from the module name (racpad_<module> by default)
//   2. Extracts keywords from the issue
//   3. Searches for matching code via GitHub Code Search
//   4. Fetches top N files, each truncated to the ~150 most relevant lines
//   5. Returns structured context ready for AI analysis
//
// Token-efficiency:
//   • Only fetches files that match the search — no full repo clone
//   • Truncates each file to 150 lines around the keyword match
//   • Deduplicates so the same file is never fetched twice
//   • Falls back to a single-keyword retry if combined query returns nothing
server.tool(
  "fetch_issue_context",
  {
    issue: z.string().describe(
      "User's question or issue in plain English, e.g. 'Agreement creation fails when customer has no address'"
    ),
    module: z.string().optional().describe(
      "Module name if known, e.g. 'agreement', 'payment', 'customer'. " +
      "For racpad frontend repos the resolved repo will be racpad_<module>."
    ),
    repo: z.string().optional().describe(
      "Exact repo name if already known, e.g. 'racpad_agreement'. Skips repo resolution when provided."
    ),
    org: z.string().optional().describe("GitHub org. Defaults to rentacenter."),
    max_files: z.number().optional().describe("Max files to retrieve content for (default 3)."),
  },
  async ({ issue, module, repo, org = DEFAULT_ORG, max_files = 3 }) => {
    try {
      // ── Step 1: Resolve repo ──────────────────────────────────────────────
      let targetRepo = repo;
      if (!targetRepo && module) {
        const moduleName = module.toLowerCase().replace(/\s+/g, "-");
        const candidate = `racpad_${moduleName}`;
        try {
          await github.get(`/repos/${org}/${candidate}`);
          targetRepo = candidate;
        } catch {
          // repo doesn't exist — fall back to org-wide search
        }
      }

      // ── Step 2: Extract keywords ──────────────────────────────────────────
      const keywords = extractKeywords(issue);
      if (keywords.length === 0) {
        return {
          content: [{ type: "text", text: "Could not extract meaningful keywords. Please describe the issue with more specific terms." }],
          isError: true,
        };
      }

      // ── Step 3: Search code ───────────────────────────────────────────────
      const buildQ = (kws) =>
        kws.join(" ") + (targetRepo ? ` repo:${org}/${targetRepo}` : ` org:${org}`);

      let searchRes = await github.get("/search/code", {
        params: { q: buildQ(keywords.slice(0, 4)), per_page: max_files * 2 },
        headers: { Accept: "application/vnd.github.v3.text-match+json" },
      });

      // Retry with single keyword if nothing matched
      if (searchRes.data.total_count === 0 && keywords.length > 1) {
        searchRes = await github.get("/search/code", {
          params: { q: buildQ([keywords[0]]), per_page: max_files },
          headers: { Accept: "application/vnd.github.v3.text-match+json" },
        });
      }

      if (searchRes.data.total_count === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: "No matching code found. Try providing the exact function/component name or the repo name.",
              repo: targetRepo ?? `org: ${org}`,
              keywords_tried: keywords,
            }, null, 2),
          }],
        };
      }

      // ── Step 4: Deduplicate & fetch top files ─────────────────────────────
      const seen = new Set();
      const topFiles = searchRes.data.items
        .filter((item) => {
          const key = `${item.repository.name}/${item.path}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, max_files);

      const settled = await Promise.allSettled(
        topFiles.map(async (item) => {
          const fileRes = await github.get(
            `/repos/${item.repository.full_name}/contents/${item.path}`
          );
          const raw = Buffer.from(fileRes.data.content, "base64").toString();
          return {
            repo: item.repository.name,
            path: item.path,
            url: item.html_url,
            snippets: (item.text_matches || []).map((m) => m.fragment.trim()),
            content: truncateToRelevantSection(raw, keywords[0], 150),
          };
        })
      );

      const files = settled.map((r, i) =>
        r.status === "fulfilled"
          ? r.value
          : {
              repo: topFiles[i].repository.name,
              path: topFiles[i].path,
              url: topFiles[i].html_url,
              error: r.reason?.message ?? "Failed to fetch",
            }
      );

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            issue,
            repo: targetRepo ?? `org-wide (${org})`,
            keywords_used: keywords,
            total_matches: searchRes.data.total_count,
            files,
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool 9: Clone & search (fast local grep) ────────────────────────────────
//
// Fastest approach for broad code analysis:
//   1. git clone --depth=1 (single round-trip, full file tree)
//   2. Recursive local regex search across all matching files (near-instant)
//   3. Return file paths + line numbers + surrounding context
//   4. Delete the clone
//
// ~10-30x faster than individual GitHub API file fetches for multi-file searches.
// Requires git to be installed on the machine running the MCP server.

function walkAndSearch(dir, pattern, extensions, maxResults, contextLines) {
  const results = [];
  const re = new RegExp(pattern, "gi");

  function walk(current) {
    if (results.length >= maxResults) return;
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "build") continue;

      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (extensions.length === 0 || extensions.some((ext) => entry.name.endsWith(ext))) {
        let content;
        try { content = readFileSync(full, "utf8"); } catch { continue; }
        const lines = content.split("\n");
        const matches = [];
        lines.forEach((line, i) => {
          re.lastIndex = 0;
          if (re.test(line)) {
            const start = Math.max(0, i - contextLines);
            const end = Math.min(lines.length - 1, i + contextLines);
            matches.push({
              line: i + 1,
              match: line.trim(),
              context: lines.slice(start, end + 1).map((l, idx) => `${start + idx + 1}: ${l}`).join("\n"),
            });
          }
        });
        if (matches.length > 0) {
          results.push({ path: full.replace(dir, "").replace(/\\/g, "/"), matches });
        }
      }
    }
  }

  walk(dir);
  return results;
}

server.tool(
  "clone_and_search",
  {
    repo: z.string().describe("Repo name, e.g. 'racpad_agreement'"),
    pattern: z.string().describe("Regex or text to search for, e.g. 'disabled.*Transfer', 'transferAgreement'"),
    path_filter: z.string().optional().describe("Subdirectory to limit the clone to via sparse-checkout, e.g. 'src/components'. Omit to search entire repo."),
    extensions: z.array(z.string()).optional().describe("File extensions to include, e.g. ['.tsx','.ts']. Omit for all files."),
    org: z.string().optional().describe("GitHub org. Defaults to rentacenter."),
    max_results: z.number().optional().describe("Max matching files to return (default 10)."),
    context_lines: z.number().optional().describe("Lines of context around each match (default 5)."),
  },
  async ({ repo, pattern, path_filter, extensions = [".tsx", ".ts", ".js", ".jsx"], org = DEFAULT_ORG, max_results = 10, context_lines = 5 }) => {
    let tmpDir = null;
    const startMs = Date.now();

    try {
      tmpDir = mkdtempSync(join(tmpdir(), "rac-clone-"));
      const token = process.env.GITHUB_TOKEN;
      // Embed token in URL for auth (token never written to disk)
      const cloneUrl = `https://${token}@github.com/${org}/${repo}.git`;

      // Shallow clone — depth=1 means no history, just latest snapshot
      const cloneCmd = path_filter
        ? `git clone --depth=1 --filter=blob:none --sparse --quiet "${cloneUrl}" "${tmpDir}"`
        : `git clone --depth=1 --quiet "${cloneUrl}" "${tmpDir}"`;

      execSync(cloneCmd, { timeout: 60000, stdio: "pipe" });

      // If sparse, only checkout the requested subdirectory (downloads only those blobs)
      if (path_filter) {
        execSync(`git -C "${tmpDir}" sparse-checkout set "${path_filter}"`, { timeout: 30000, stdio: "pipe" });
      }

      const searchRoot = path_filter ? join(tmpDir, path_filter) : tmpDir;
      const results = walkAndSearch(searchRoot, pattern, extensions, max_results, context_lines);
      const elapsed = Date.now() - startMs;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            repo,
            pattern,
            path_filter: path_filter ?? "entire repo",
            elapsed_ms: elapsed,
            files_matched: results.length,
            results,
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    } finally {
      if (tmpDir) {
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }
);

// ─── Tool 10: Recent commits (what changed & when) ───────────────────────────
//
// Support use-case: "Something broke recently in agreement — what changed?"
// Returns the last N commits with author, date, message, and files touched.
server.tool(
  "get_recent_commits",
  {
    repo: z.string().describe("Repo name, e.g. 'racpad_agreement'"),
    branch: z.string().optional().describe("Branch name. Defaults to the repo's default branch."),
    path: z.string().optional().describe("Limit to commits that touched a specific file/folder, e.g. 'client/src/components/AgreementTransfer'"),
    org: z.string().optional(),
    limit: z.number().optional().describe("Number of commits to return (default 10, max 30)"),
  },
  async ({ repo, branch, path, org = DEFAULT_ORG, limit = 10 }) => {
    try {
      const params = { per_page: Math.min(limit, 30) };
      if (branch) params.sha = branch;
      if (path)   params.path = path;

      const res = await github.get(`/repos/${org}/${repo}/commits`, { params });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            repo,
            branch: branch ?? "default",
            path_filter: path ?? "all files",
            commits: res.data.map((c) => ({
              sha: c.sha.slice(0, 8),
              author: c.commit.author.name,
              date: c.commit.author.date,
              message: c.commit.message.split("\n")[0],
              url: c.html_url,
            })),
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool 11: Get commit diff (what exactly changed in a commit) ──────────────
//
// Support use-case: "Show me what changed in commit abc1234 in racpad_payment"
server.tool(
  "get_commit_diff",
  {
    repo: z.string().describe("Repo name, e.g. 'racpad_payment'"),
    sha: z.string().describe("Commit SHA (full or short, e.g. 'abc1234')"),
    org: z.string().optional(),
  },
  async ({ repo, sha, org = DEFAULT_ORG }) => {
    try {
      const res = await github.get(`/repos/${org}/${repo}/commits/${sha}`, {
        headers: { Accept: "application/vnd.github.v3+json" },
      });
      const c = res.data;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            sha: c.sha.slice(0, 8),
            author: c.commit.author.name,
            date: c.commit.author.date,
            message: c.commit.message,
            files_changed: c.files?.map((f) => ({
              filename: f.filename,
              status: f.status,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch ? f.patch.slice(0, 2000) + (f.patch.length > 2000 ? "\n... patch truncated ..." : "") : null,
            })),
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool 12: Find feature flags ──────────────────────────────────────────────
//
// Support use-case: "What feature flags control the transfer agreement flow?"
// Clones the repo and greps for all featureFlagDetails / feature flag references.
server.tool(
  "find_feature_flags",
  {
    repo: z.string().describe("Repo name, e.g. 'racpad_agreement'"),
    org: z.string().optional(),
  },
  async ({ repo, org = DEFAULT_ORG }) => {
    let tmpDir = null;
    try {
      tmpDir = mkdtempSync(join(tmpdir(), "rac-ff-"));
      const token = process.env.GITHUB_TOKEN;
      execSync(`git clone --depth=1 --quiet "https://${token}@github.com/${org}/${repo}.git" "${tmpDir}"`, {
        timeout: 60000, stdio: "pipe",
      });

      // Walk and collect all unique feature flag key names
      const flagPattern = /featureFlagDetails\?\.\s*(\w+)|featureFlagDetails\[['"](\w+)['"]\]/g;
      const flagSet = new Map(); // flagName -> [file:line, ...]
      const extensions = [".tsx", ".ts", ".js", ".jsx"];

      function walk(dir) {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (["node_modules", ".git", "dist", "build"].includes(entry.name)) continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) { walk(full); continue; }
          if (!extensions.some((e) => entry.name.endsWith(e))) continue;
          let content;
          try { content = readFileSync(full, "utf8"); } catch { continue; }
          const lines = content.split("\n");
          lines.forEach((line, i) => {
            let m;
            flagPattern.lastIndex = 0;
            while ((m = flagPattern.exec(line)) !== null) {
              const flag = m[1] || m[2];
              const ref = `${full.replace(tmpDir, "").replace(/\\/g, "/")}:${i + 1}`;
              if (!flagSet.has(flag)) flagSet.set(flag, []);
              flagSet.get().push(ref);
            }
          });
        }
      }

      walk(tmpDir);

      const flags = Array.from(flagSet.entries()).map(([flag, usages]) => ({ flag, used_in: usages }));
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ repo, total_flags: flags.length, flags }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    } finally {
      if (tmpDir) try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /**/ }
    }
  }
);

// ─── Tool 13: Find all error / popup messages in a repo ───────────────────────
//
// Support use-case: "What error messages can appear on the payment screen?"
// Clones and extracts all user-facing strings: error popups, alerts, toasts.
server.tool(
  "find_error_messages",
  {
    repo: z.string().describe("Repo name, e.g. 'racpad_payment'"),
    component: z.string().optional().describe("Narrow to a subfolder, e.g. 'Payment' or 'AgreementTransfer'"),
    org: z.string().optional(),
  },
  async ({ repo, component, org = DEFAULT_ORG }) => {
    let tmpDir = null;
    try {
      tmpDir = mkdtempSync(join(tmpdir(), "rac-err-"));
      const token = process.env.GITHUB_TOKEN;

      const cloneCmd = component
        ? `git clone --depth=1 --filter=blob:none --sparse --quiet "https://${token}@github.com/${org}/${repo}.git" "${tmpDir}"`
        : `git clone --depth=1 --quiet "https://${token}@github.com/${org}/${repo}.git" "${tmpDir}"`;
      execSync(cloneCmd, { timeout: 60000, stdio: "pipe" });
      if (component) {
        execSync(`git -C "${tmpDir}" sparse-checkout set "client/src/components/${component}"`, { timeout: 30000, stdio: "pipe" });
      }

      // Patterns that indicate user-facing messages
      const msgPatterns = [
        /setmanageAgrErrMessage\(['"`]([^'"`]+)['"`]\)/,
        /\bt\(['"`]([^'"`]{10,})['"`]\)/,                    // i18n t("...") calls
        /(?:message|error|alert|toast|popup).*?['"`]([A-Z][^'"`]{10,})['"`]/i,
        /<Typography[^>]*>\s*\{t\(['"`]([^'"`]{10,})['"`]\)\}/,
      ];

      const messages = new Map(); // message -> files
      const extensions = [".tsx", ".ts", ".jsx"];

      function walk(dir) {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (["node_modules", ".git", "dist", "build"].includes(entry.name)) continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) { walk(full); continue; }
          if (!extensions.some((e) => entry.name.endsWith(e))) continue;
          let content;
          try { content = readFileSync(full, "utf8"); } catch { continue; }
          const relPath = full.replace(tmpDir, "").replace(/\\/g, "/");
          content.split("\n").forEach((line) => {
            for (const p of msgPatterns) {
              const m = p.exec(line);
              if (m?.[1]) {
                const msg = m[1].trim();
                if (!messages.has(msg)) messages.set(msg, new Set());
                messages.get().add(relPath);
              }
            }
          });
        }
      }

      const root = component ? join(tmpDir, "client", "src", "components", component) : tmpDir;
      walk(root);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            repo,
            component: component ?? "all",
            total_messages: messages.size,
            messages: Array.from(messages.entries()).map(([msg, files]) => ({
              message: msg,
              files: Array.from(files),
            })),
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    } finally {
      if (tmpDir) try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /**/ }
    }
  }
);

// ─── Tool 14: Get open pull requests ─────────────────────────────────────────
//
// Support use-case: "Are there any open PRs for the agreement module?"
// Useful for knowing if a reported bug already has a fix in progress.
server.tool(
  "get_open_prs",
  {
    repo: z.string().describe("Repo name, e.g. 'racpad_agreement'"),
    org: z.string().optional(),
    limit: z.number().optional().describe("Max PRs to return (default 10)"),
  },
  async ({ repo, org = DEFAULT_ORG, limit = 10 }) => {
    try {
      const res = await github.get(`/repos/${org}/${repo}/pulls`, {
        params: { state: "open", per_page: Math.min(limit, 30), sort: "updated", direction: "desc" },
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            repo,
            open_prs: res.data.length,
            prs: res.data.map((pr) => ({
              number: pr.number,
              title: pr.title,
              author: pr.user.login,
              branch: pr.head.ref,
              created_at: pr.created_at,
              updated_at: pr.updated_at,
              url: pr.html_url,
              labels: pr.labels.map((l) => l.name),
            })),
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool 15: Multi-repo search (find a function/component across all racpad repos) ──
//
// Support use-case: "Where is CustomerClub used across all racpad_ repos?"
// Uses GitHub Code Search (rate-limited to 10 req/min) — use sparingly.
server.tool(
  "multi_repo_search",
  {
    query: z.string().describe("Exact symbol, function, or text to search, e.g. 'useCustomerClub', 'EnableClubTransfer'"),
    prefix: z.string().optional().describe("Limit to repos starting with this prefix, e.g. 'racpad', 'es'. Defaults to 'racpad'."),
    org: z.string().optional(),
    language: z.string().optional().describe("Language filter, e.g. 'typescript'"),
    max_results: z.number().optional().describe("Max results (default 8)"),
  },
  async ({ query, prefix = "racpad", org = DEFAULT_ORG, language, max_results = 8 }) => {
    try {
      let q = `${query} org:${org}`;
      if (language) q += ` language:${language}`;
      // GitHub doesn't support prefix filtering in code search — we post-filter
      const res = await github.get("/search/code", {
        params: { q, per_page: 30 },
        headers: { Accept: "application/vnd.github.v3.text-match+json" },
      });
      const filtered = res.data.items.filter((item) => item.repository.name.startsWith(prefix));
      const top = filtered.slice(0, max_results);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            query,
            prefix_filter: prefix,
            total_org_matches: res.data.total_count,
            prefix_matches: filtered.length,
            results: top.map((item) => ({
              repo: item.repository.name,
              path: item.path,
              url: item.html_url,
              snippets: (item.text_matches || []).map((m) => m.fragment.trim()),
            })),
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool 16: Get all API endpoints used in a component ────────────────────────
//
// Support use-case: "What APIs does the agreement transfer screen call?"
// Clones the repo, finds all axios/fetch/API calls in the relevant component folder.
server.tool(
  "get_api_calls",
  {
    repo: z.string().describe("Repo name, e.g. 'racpad_agreement'"),
    component: z.string().optional().describe("Component folder name, e.g. 'AgreementTransfer'. Searches entire src if omitted."),
    org: z.string().optional(),
  },
  async ({ repo, component, org = DEFAULT_ORG }) => {
    let tmpDir = null;
    try {
      tmpDir = mkdtempSync(join(tmpdir(), "rac-api-"));
      const token = process.env.GITHUB_TOKEN;

      const sparseTarget = component
        ? `client/src/components/${component}`
        : "client/src";

      execSync(
        `git clone --depth=1 --filter=blob:none --sparse --quiet "https://${token}@github.com/${org}/${repo}.git" "${tmpDir}"`,
        { timeout: 60000, stdio: "pipe" }
      );
      execSync(`git -C "${tmpDir}" sparse-checkout set "${sparseTarget}"`, { timeout: 30000, stdio: "pipe" });

      // API call patterns: axios calls, custom API functions (GetXxx, PostXxx, UpdateXxx, DeleteXxx)
      const patterns = [
        { name: "axios/fetch", re: /(?:axios|fetch)\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/ },
        { name: "custom API fn", re: /(?:await\s+|=\s*)([A-Z][a-z]+(?:[A-Z][a-zA-Z]+)*)\s*\(/ },
        { name: "API path string", re: /['"`](\/(?:api|agreement|customer|payment|store|inventory)[^'"`]+)['"`]/ },
      ];

      const apiCalls = new Map();
      const extensions = [".tsx", ".ts", ".js", ".jsx"];

      function walk(dir) {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (["node_modules", ".git", "dist", "build"].includes(entry.name)) continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) { walk(full); continue; }
          if (!extensions.some((e) => entry.name.endsWith(e))) continue;
          let content;
          try { content = readFileSync(full, "utf8"); } catch { continue; }
          const relPath = full.replace(tmpDir, "").replace(/\\/g, "/");
          content.split("\n").forEach((line) => {
            for (const { name, re } of patterns) {
              const m = re.exec(line);
              if (m?.[1] && m[1].length > 3) {
                const key = m[1];
                if (!apiCalls.has(key)) apiCalls.set(key, { type: name, files: [] });
                if (!apiCalls.get().files.includes(relPath)) {
                  apiCalls.get().files.push(relPath);
                }
              }
            }
          });
        }
      }

      const searchRoot = join(tmpDir, ...sparseTarget.split("/"));
      walk(searchRoot);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            repo,
            component: component ?? "entire src",
            total_api_calls: apiCalls.size,
            api_calls: Array.from(apiCalls.entries()).map(([call, info]) => ({
              call,
              type: info.type,
              files: info.files,
            })),
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    } finally {
      if (tmpDir) try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /**/ }
    }
  }
);

// ─── Start ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("✅ MCP GitHub server running (v3.0.0)...");

