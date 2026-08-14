import { useState, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { FolderIcon, FolderPlusIcon } from "@heroicons/react/24/outline";
import type {
  CreateProjectRequest,
  CreateProjectResponse,
  ProjectsResponse,
  ProjectInfo,
} from "../types";
import { getProjectsUrl } from "../config/api";
import { SettingsButton } from "./SettingsButton";
import { SettingsModal } from "./SettingsModal";

export function ProjectSelector() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newProjectPath, setNewProjectPath] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const response = await fetch(getProjectsUrl());
      if (!response.ok) {
        throw new Error(`Failed to load projects: ${response.statusText}`);
      }
      const data: ProjectsResponse = await response.json();
      setProjects(data.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  };

  const handleProjectSelect = (projectPath: string) => {
    const normalizedPath = projectPath.startsWith("/")
      ? projectPath
      : `/${projectPath}`;
    navigate(`/projects${normalizedPath}`);
  };

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const path = newProjectPath.trim();
    if (!path || creating) return;

    try {
      setCreating(true);
      setCreateError(null);
      const request: CreateProjectRequest = { path };
      const response = await fetch(getProjectsUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const data = (await response.json()) as
        | CreateProjectResponse
        | { error?: string };
      if (!response.ok || !("project" in data)) {
        throw new Error(
          "error" in data && data.error
            ? data.error
            : "Failed to create project",
        );
      }
      handleProjectSelect(data.project.path);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create project",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleSettingsClick = () => {
    setIsSettingsOpen(true);
  };

  const handleSettingsClose = () => {
    setIsSettingsOpen(false);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-app)]">
        <div className="thinking-shimmer text-sm text-[var(--text-secondary)]">
          Loading projects...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-4xl p-5 sm:p-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <span className="mb-3 inline-flex rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent-strong)]">
              AI Builder
            </span>
            <h1 className="text-3xl font-semibold tracking-tight">
              Select a Project
            </h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Open a workspace and continue building with Claude.
            </p>
          </div>
          <SettingsButton onClick={handleSettingsClick} />
        </div>

        <form
          onSubmit={handleCreateProject}
          className="mb-10 rounded-2xl bg-[var(--surface-panel)] p-5 shadow-[0_2px_12px_rgba(15,23,42,0.06)] ring-1 ring-[var(--border-subtle)]"
        >
          <div className="mb-4 flex items-start gap-3">
            <div className="rounded-xl bg-[var(--accent-soft)] p-2 text-[var(--accent-strong)]">
              <FolderPlusIcon className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-semibold">Start a new project</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Enter a new directory or an existing folder. Relative paths are
                created inside your home directory.
              </p>
            </div>
          </div>

          <label
            htmlFor="new-project-path"
            className="mb-2 block text-sm font-medium text-[var(--text-secondary)]"
          >
            Project directory
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="new-project-path"
              value={newProjectPath}
              onChange={(event) => setNewProjectPath(event.target.value)}
              placeholder="~/my-project"
              autoComplete="off"
              disabled={creating}
              className="min-w-0 flex-1 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-panel)] px-3 py-2.5 font-mono text-sm outline-none transition-[border-color,box-shadow] placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!newProjectPath.trim() || creating}
              className="rounded-full bg-[var(--text-primary)] px-5 py-2.5 text-sm font-medium text-[var(--surface-panel)] transition-[opacity,transform] hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create project"}
            </button>
          </div>
          {createError && (
            <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
              {createError}
            </p>
          )}
        </form>

        <div className="space-y-3">
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-red-50 p-3 text-sm text-[var(--danger)] ring-1 ring-red-200 dark:bg-red-950/30 dark:ring-red-900"
            >
              Failed to load existing projects: {error}
            </p>
          )}
          {projects.length > 0 && (
            <>
              <h2 className="mb-4 text-sm font-semibold text-[var(--text-secondary)]">
                Recent Projects
              </h2>
              {projects.map((project) => (
                <button
                  key={project.path}
                  onClick={() => handleProjectSelect(project.path)}
                  data-testid="project-card"
                  className="flex w-full items-center gap-3 rounded-xl bg-[var(--surface-panel)] p-4 text-left ring-1 ring-[var(--border-subtle)] transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] motion-reduce:transform-none"
                >
                  <FolderIcon className="h-5 w-5 flex-shrink-0 text-[var(--accent-strong)]" />
                  <span className="font-mono text-sm text-[var(--text-primary)]">
                    {project.path}
                  </span>
                </button>
              ))}
            </>
          )}
          {!error && projects.length === 0 && (
            <p className="rounded-xl border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--text-tertiary)]">
              No projects yet. Create one above to start working.
            </p>
          )}
        </div>

        {/* Settings Modal */}
        <SettingsModal isOpen={isSettingsOpen} onClose={handleSettingsClose} />
      </div>
    </div>
  );
}
