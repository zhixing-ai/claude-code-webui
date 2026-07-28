import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeProjectPath } from "../history/pathUtils.ts";
import { makeDir, readTextFile, stat, withTempDir } from "../utils/fs.ts";
import { createProject } from "./projects.ts";

describe("createProject", () => {
  it("creates and registers a project in a fresh home directory", async () => {
    await withTempDir(async (tempDir) => {
      const homeDir = join(tempDir, "home");
      await makeDir(homeDir);

      const project = await createProject("workspace", homeDir);
      const expectedPath = join(homeDir, "workspace");
      const config = JSON.parse(
        await readTextFile(join(homeDir, ".claude.json")),
      );
      const history = await stat(
        join(homeDir, ".claude", "projects", encodeProjectPath(expectedPath)),
      );

      expect(project).toEqual({
        path: expectedPath,
        encodedName: encodeProjectPath(expectedPath),
      });
      expect(config.projects[expectedPath]).toEqual({});
      expect(history.isDirectory).toBe(true);
    });
  });
});
