import fs from "fs";
import path from "path";
import { execSync } from "child_process";

export class WorkspaceManager {
  private baseDir: string;

  constructor(sandboxRoot: string) {
    this.baseDir = path.join(sandboxRoot, ".yoof1337-worktrees");
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    // Also ignore in git if .gitignore exists
    const gitignorePath = path.join(sandboxRoot, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, "utf-8");
      if (!content.includes(".yoof1337-worktrees")) {
        fs.appendFileSync(gitignorePath, "\n.yoof1337-worktrees\n");
      }
    }
  }

  createWorktree(taskId: string, sandboxRoot: string): string {
    const worktreePath = path.join(this.baseDir, taskId);
    const branchName = `task-${taskId}`;
    
    // Check if git is initialized
    try {
      execSync("git rev-parse --is-inside-work-tree", { cwd: sandboxRoot, stdio: "ignore" });
    } catch {
      throw new Error("Cannot create worktree: Sandbox is not a git repository.");
    }

    try {
      // Create worktree
      execSync(`git worktree add -b ${branchName} "${worktreePath}"`, { cwd: sandboxRoot, stdio: "pipe" });
      return worktreePath;
    } catch (err: any) {
      throw new Error(`Failed to create worktree: ${err.message}`);
    }
  }

  removeWorktree(taskId: string, sandboxRoot: string): void {
    const worktreePath = path.join(this.baseDir, taskId);
    if (!fs.existsSync(worktreePath)) return;

    try {
      execSync(`git worktree remove --force "${worktreePath}"`, { cwd: sandboxRoot, stdio: "pipe" });
      const branchName = `task-${taskId}`;
      execSync(`git branch -D ${branchName}`, { cwd: sandboxRoot, stdio: "ignore" });
    } catch (err: any) {
      throw new Error(`Failed to remove worktree: ${err.message}`);
    }
  }

  mergeWorktree(taskId: string, sandboxRoot: string): void {
    const branchName = `task-${taskId}`;
    try {
      execSync(`git merge ${branchName} --no-ff -m "Merge task ${taskId}"`, { cwd: sandboxRoot, stdio: "pipe" });
    } catch (err: any) {
      throw new Error(`Failed to merge worktree branch ${branchName}: ${err.message}. Resolve conflicts manually.`);
    }
  }
}

let managerInstance: WorkspaceManager | null = null;

export function getWorkspaceManager(sandboxRoot: string): WorkspaceManager {
  if (!managerInstance) {
    managerInstance = new WorkspaceManager(sandboxRoot);
  }
  return managerInstance;
}
