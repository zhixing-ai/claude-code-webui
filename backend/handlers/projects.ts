import { isAbsolute, join, parse, resolve } from "node:path";
import type { Context } from "hono";
import type {
  CreateProjectResponse,
  ProjectInfo,
  ProjectsResponse,
} from "../../shared/types.ts";
import {
  encodeProjectPath,
  getEncodedProjectName,
} from "../history/pathUtils.ts";
import { logger } from "../utils/logger.ts";
import {
  isNotFoundError,
  makeDir,
  readTextFile,
  stat,
  writeTextFile,
} from "../utils/fs.ts";
import { getHomeDir } from "../utils/os.ts";

const NOT_A_DIRECTORY = "Project path exists and is not a directory";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveProjectPath(inputPath: string, homeDir: string): string {
  const input = inputPath.trim();
  if (input === "~") return resolve(homeDir);
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return resolve(homeDir, input.slice(2));
  }
  return isAbsolute(input) ? resolve(input) : resolve(homeDir, input);
}

export async function createProject(
  inputPath: string,
  homeDir: string,
): Promise<ProjectInfo> {
  const projectPath = resolveProjectPath(inputPath, homeDir);

  try {
    const projectStats = await stat(projectPath);
    if (!projectStats.isDirectory) {
      throw new Error(NOT_A_DIRECTORY);
    }
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    await makeDir(projectPath);
  }

  const claudeConfigPath = join(homeDir, ".claude.json");
  let config: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readTextFile(claudeConfigPath));
    if (!isObject(parsed)) {
      throw new Error("Claude configuration must contain a JSON object");
    }
    config = parsed;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  const projects = isObject(config.projects) ? config.projects : {};
  const encodedName = encodeProjectPath(projectPath);
  await makeDir(join(homeDir, ".claude", "projects", encodedName));

  if (!(projectPath in projects)) {
    config.projects = { ...projects, [projectPath]: {} };
    await writeTextFile(
      claudeConfigPath,
      `${JSON.stringify(config, null, 2)}\n`,
    );
  }

  return { path: projectPath, encodedName };
}

/**
 * Handles GET /api/projects requests
 * Retrieves list of available project directories from Claude configuration
 * @param c - Hono context object
 * @returns JSON response with projects array
 */
export async function handleProjectsRequest(c: Context) {
  try {
    const homeDir = getHomeDir();
    if (!homeDir) {
      return c.json({ error: "Home directory not found" }, 500);
    }

    const claudeConfigPath = `${homeDir}/.claude.json`;

    try {
      const configContent = await readTextFile(claudeConfigPath);
      const config = JSON.parse(configContent);

      if (config.projects && typeof config.projects === "object") {
        const projectPaths = Object.keys(config.projects);

        // Get encoded names for each project, only include projects with history
        const projects: ProjectInfo[] = [];
        for (const path of projectPaths) {
          const encodedName = await getEncodedProjectName(path);
          // Only include projects that have history directories
          if (encodedName) {
            projects.push({
              path,
              encodedName,
            });
          }
        }

        const response: ProjectsResponse = { projects };
        return c.json(response);
      } else {
        const response: ProjectsResponse = { projects: [] };
        return c.json(response);
      }
    } catch (error) {
      // Handle file not found errors in a cross-platform way
      if (isNotFoundError(error)) {
        const response: ProjectsResponse = { projects: [] };
        return c.json(response);
      }
      throw error;
    }
  } catch (error) {
    logger.api.error("Error reading projects: {error}", { error });
    return c.json({ error: "Failed to read projects" }, 500);
  }
}

export async function handleCreateProjectRequest(c: Context) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (
    !isObject(body) ||
    typeof body.path !== "string" ||
    !body.path.trim() ||
    body.path.length > 4096 ||
    body.path.includes("\0")
  ) {
    return c.json({ error: "A valid project path is required" }, 400);
  }

  const homeDir = getHomeDir();
  if (!homeDir) {
    return c.json({ error: "Home directory not found" }, 500);
  }

  const projectPath = resolveProjectPath(body.path, homeDir);
  if (projectPath === parse(projectPath).root) {
    return c.json({ error: "The filesystem root cannot be a project" }, 400);
  }

  try {
    const project = await createProject(body.path, homeDir);
    const response: CreateProjectResponse = { project };
    return c.json(response, 201);
  } catch (error) {
    if (error instanceof Error && error.message === NOT_A_DIRECTORY) {
      return c.json({ error: error.message }, 409);
    }
    logger.api.error("Error creating project: {error}", { error });
    return c.json({ error: "Failed to create project" }, 500);
  }
}
