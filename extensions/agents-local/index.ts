/**
 * Personal Context Extension
 *
 * Auto-loads `AGENTS.local.md` and, where a `work/` dir exists, keeps its
 * project table in sync with `work/` on disk each session.
 *
 * Two harness layouts are supported:
 *
 *   nested   - projects live inside the harness (`harness/work/my-app`).
 *              The harness is an ancestor of cwd, so it can be found by
 *              walking up from cwd.
 *   sibling  - projects live beside the harness (`codetools/friendly-harness`
 *              and `codetools/my-app`). The harness is NOT an ancestor of
 *              cwd, so walking up can never reach it. It is located instead
 *              from PI_CODING_AGENT_DIR, which the launcher exports as
 *              `<harness>/.pi/agent`.
 */

import {
	existsSync,
	readFileSync,
	writeFileSync,
	readdirSync,
	statSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LOCAL_FILENAME = "AGENTS.local.md";
const WORK_SECTION = "## work/ (projects)";
const WORK_SYNC_START = "<!-- agents-local:work-sync -->";
const WORK_SYNC_END = "<!-- /agents-local:work-sync -->";

/**
 * Harness root from PI_CODING_AGENT_DIR (`<harness>/.pi/agent`), exported by
 * bin/pi. Exact, and works when the harness is a sibling of the project
 * rather than an ancestor.
 */
function harnessRootFromEnv(): string | null {
	const agent_dir = process.env.PI_CODING_AGENT_DIR;
	if (!agent_dir) return null;
	const root = resolve(agent_dir, "..", "..");
	return existsSync(root) ? root : null;
}

function findHarnessRoot(cwd: string): string | null {
	const from_env = harnessRootFromEnv();
	if (from_env) return from_env;

	// Nested layout only: walk up for a dir holding both AGENTS.md and work/.
	const root = resolve("/");
	let currentDir = resolve(cwd);

	while (true) {
		if (
			existsSync(join(currentDir, "AGENTS.md")) &&
			existsSync(join(currentDir, "work"))
		) {
			return currentDir;
		}
		if (currentDir === root) break;
		const parent = dirname(currentDir);
		if (parent === currentDir) break;
		currentDir = parent;
	}

	return null;
}

/** Nearest AGENTS.local.md walking up from cwd, stopping at the repo boundary. */
function findProjectLocalFile(cwd: string): string | null {
	const root = resolve("/");
	let currentDir = resolve(cwd);

	while (true) {
		const candidate = join(currentDir, LOCAL_FILENAME);
		if (existsSync(candidate)) return candidate;

		const gitDir = join(currentDir, ".git");
		if (existsSync(gitDir)) break;

		if (currentDir === root) break;
		const parent = dirname(currentDir);
		if (parent === currentDir) break;
		currentDir = parent;
	}

	return null;
}

/**
 * Every AGENTS.local.md that applies, harness first and project appended, so
 * the project file is read last and wins on conflict. Deduped when cwd is
 * inside the harness itself, where both lookups find the same file.
 */
function findLocalContextFiles(cwd: string): string[] {
	const files: string[] = [];

	const harness = findHarnessRoot(cwd);
	if (harness) {
		const harnessLocal = join(harness, LOCAL_FILENAME);
		if (existsSync(harnessLocal)) files.push(harnessLocal);
	}

	const projectLocal = findProjectLocalFile(cwd);
	if (projectLocal && !files.includes(projectLocal)) files.push(projectLocal);

	return files;
}

/** Labelled, concatenated contents of the applicable AGENTS.local.md files. */
function buildLocalContextBlock(files: string[]): string {
	const parts = files
		.map((file) => {
			const content = readLocalContext(file);
			return content ? `### \`${file}\`\n\n${content}` : "";
		})
		.filter(Boolean);

	if (parts.length === 0) return "";

	const note =
		parts.length > 1
			? "Harness context first, then the active project's. Where they conflict, the project file wins.\n\n"
			: "";

	return note + parts.join("\n\n");
}

function readLocalContext(filePath: string): string {
	try {
		return readFileSync(filePath, "utf-8").trim();
	} catch {
		return "";
	}
}

function parseWorkDescriptions(content: string): Map<string, string> {
	const descriptions = new Map<string, string>();
	const block =
		content.match(
			new RegExp(
				`${WORK_SYNC_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\s\\S]*?)${WORK_SYNC_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
			),
		)?.[1] ?? content;

	for (const line of block.split("\n")) {
		const match = line.match(/^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|$/);
		if (match) descriptions.set(match[1], match[2]);
	}

	return descriptions;
}

function projectHint(projectDir: string): string {
	const pkgPath = join(projectDir, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
				description?: string;
				name?: string;
			};
			if (pkg.description && pkg.description !== pkg.name)
				return pkg.description;
			if (pkg.name) return pkg.name;
		} catch {
			/* fall through */
		}
	}

	const readmePath = join(projectDir, "README.md");
	if (existsSync(readmePath)) {
		try {
			for (const line of readFileSync(readmePath, "utf-8").split("\n")) {
				const text = line.replace(/^#+\s*/, "").trim();
				if (text && !text.startsWith("![")) return text.slice(0, 80);
			}
		} catch {
			/* fall through */
		}
	}

	return "(add description)";
}

function buildWorkSyncBlock(
	projects: string[],
	descriptions: Map<string, string>,
	workPath: string,
): string {
	const rows = [...projects].sort().map((name) => {
		const desc =
			descriptions.get(name) ?? projectHint(join(workPath, name));
		return `| \`${name}\` | ${desc} |`;
	});

	const noGit = projects
		.filter((name) => !existsSync(join(workPath, name, ".git")))
		.sort();

	return `${WORK_SYNC_START}
| Project | What it is |
|---------|------------|
${rows.join("\n")}

No git: ${noGit.map((name) => `\`${name}\``).join(", ")}.
${WORK_SYNC_END}`;
}

function syncWorkSection(harnessRoot: string, localPath: string): void {
	const workPath = join(harnessRoot, "work");
	if (!existsSync(workPath)) return;

	const projects = readdirSync(workPath).filter((name) => {
		if (name.startsWith(".")) return false;
		return statSync(join(workPath, name)).isDirectory();
	});

	let content = readFileSync(localPath, "utf-8");
	const descriptions = parseWorkDescriptions(content);
	const syncBlock = buildWorkSyncBlock(projects, descriptions, workPath);

	if (content.includes(WORK_SYNC_START)) {
		content = content.replace(
			new RegExp(
				`${WORK_SYNC_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${WORK_SYNC_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
			),
			syncBlock,
		);
	} else if (content.includes(WORK_SECTION)) {
		content = content.replace(
			new RegExp(`${WORK_SECTION}[\\s\\S]*?(?=\\n## |$)`),
			`${WORK_SECTION}

Projects live beside the harness under the code root. Synced from disk by agents-local each session - edit descriptions in the table; rows add and remove automatically.

${syncBlock}`,
		);
	} else {
		const anchor = content.indexOf("\n## ");
		const insert = `\n\n${WORK_SECTION}

Projects live beside the harness under the code root. Synced from disk by agents-local each session - edit descriptions in the table; rows add and remove automatically.

${syncBlock}\n`;
		content =
			anchor === -1 ? content + insert : content.slice(0, anchor) + insert + content.slice(anchor);
	}

	writeFileSync(localPath, content, "utf-8");
}

/** Splice personal context into README immediately before the last fenced block. */
function insertBeforeLastCodeBlock(readme: string, insert: string): string {
	const fence = /^```/gm;
	let lastStart = -1;
	let match: RegExpExecArray | null;
	while ((match = fence.exec(readme)) !== null) lastStart = match.index;
	if (lastStart === -1) return `${readme.trim()}\n\n${insert}\n`;
	return `${readme.slice(0, lastStart).trimEnd()}\n\n${insert}\n\n${readme.slice(lastStart)}`;
}

function buildReadmeWithLocal(harnessRoot: string, local: string): string | null {
	const readmePath = join(harnessRoot, "README.md");
	if (!existsSync(readmePath)) return null;

	if (!local) return null;

	const readme = readFileSync(readmePath, "utf-8");
	const personal = [
		"## Personal Context",
		"",
		`From \`${LOCAL_FILENAME}\` (gitignored, machine-local):`,
		"",
		local,
	].join("\n");

	return insertBeforeLastCodeBlock(readme, personal);
}

export default function agentsLocalExtension(pi: ExtensionAPI) {
	let localFiles: string[] = [];
	let localContent = "";
	let pendingInsert: string | null = null;

	pi.on("resources_discover", async (event) => {
		localFiles = findLocalContextFiles(event.cwd);
		if (localFiles.length === 0) return;

		const harnessRoot = findHarnessRoot(event.cwd) ?? dirname(localFiles[0]);
		// The work/ table belongs to the harness file, never a project's.
		const harnessLocal = join(harnessRoot, LOCAL_FILENAME);
		if (existsSync(harnessLocal)) syncWorkSection(harnessRoot, harnessLocal);

		localContent = buildLocalContextBlock(localFiles);
	});

	pi.registerCommand("insert", {
		description:
			"Splice AGENTS.local.md into README.md (before the last command block) for the next prompt",
		handler: async (_args, ctx) => {
			const harnessRoot = findHarnessRoot(ctx.cwd);
			if (!harnessRoot) {
				ctx.ui.notify("insert: harness root not found", "error");
				return;
			}

			const local =
				localContent || buildLocalContextBlock(findLocalContextFiles(ctx.cwd));
			if (!local) {
				ctx.ui.notify(`insert: no ${LOCAL_FILENAME}`, "error");
				return;
			}

			const combined = buildReadmeWithLocal(harnessRoot, local);
			if (!combined) {
				ctx.ui.notify("insert: README.md or personal context missing", "error");
				return;
			}

			pendingInsert = combined;
			ctx.ui.notify(
				"insert: README + AGENTS.local queued for next prompt",
				"info",
			);
		},
	});

	pi.on("before_agent_start", async (event) => {
		let systemPrompt = event.systemPrompt;

		if (pendingInsert) {
			systemPrompt +=
				`\n\n## README + Personal Context\n\n` +
				`Loaded via /insert (AGENTS.local spliced into README before the last command block):\n\n` +
				pendingInsert;
			pendingInsert = null;
		} else if (localContent) {
			systemPrompt +=
				`\n\n## Personal Context\n\nLoaded from ${localFiles.length} gitignored, machine-local file${localFiles.length === 1 ? "" : "s"}:\n\n` +
				localContent;
		}

		if (systemPrompt === event.systemPrompt) return;
		return { systemPrompt };
	});
}
