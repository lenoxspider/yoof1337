import fs from "node:fs/promises";
import path from "node:path";
import { resolveInSandbox, type SandboxContext } from "./sandbox.js";

export type NotebookEditMode = "replace_cell" | "add_cell" | "delete_cell" | "clear_output";

export interface NotebookEditInput {
  path: string;
  mode: NotebookEditMode;
  cellIndex?: number;
  cellType?: "code" | "markdown";
  source?: string;
}

export async function editNotebook(
  input: NotebookEditInput,
  ctx: SandboxContext
): Promise<string> {
  const target = resolveInSandbox(ctx, input.path);
  
  if (!target.endsWith(".ipynb")) {
    return "Error: File must be a Jupyter notebook (.ipynb)";
  }

  let content: string;
  try {
    content = await fs.readFile(target, "utf8");
  } catch (err) {
    if (input.mode === "add_cell") {
      content = JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 });
      await fs.mkdir(path.dirname(target), { recursive: true });
    } else {
      return `Error: Could not read notebook file: ${String(err)}`;
    }
  }

  let notebook: any;
  try {
    notebook = JSON.parse(content);
  } catch (err) {
    return `Error: Invalid JSON in notebook file: ${String(err)}`;
  }

  if (!Array.isArray(notebook.cells)) {
    return "Error: Invalid notebook format (missing cells array)";
  }

  const mode = input.mode;
  
  if (mode === "clear_output") {
    let cleared = 0;
    for (const cell of notebook.cells) {
      if (cell.cell_type === "code" && cell.outputs) {
        cell.outputs = [];
        cell.execution_count = null;
        cleared++;
      }
    }
    await fs.writeFile(target, JSON.stringify(notebook, null, 2), "utf8");
    return `Cleared outputs for ${cleared} code cells in ${input.path}.`;
  }

  const index = input.cellIndex ?? -1;

  if (mode === "delete_cell") {
    if (index < 0 || index >= notebook.cells.length) {
      return `Error: Invalid cell index ${index}. Notebook has ${notebook.cells.length} cells.`;
    }
    notebook.cells.splice(index, 1);
    await fs.writeFile(target, JSON.stringify(notebook, null, 2), "utf8");
    return `Deleted cell at index ${index} in ${input.path}.`;
  }

  if (mode === "replace_cell") {
    if (index < 0 || index >= notebook.cells.length) {
      return `Error: Invalid cell index ${index}. Notebook has ${notebook.cells.length} cells.`;
    }
    const sourceArray = input.source ? input.source.split("\n").map((line, i, arr) => i < arr.length - 1 ? line + "\n" : line) : [];
    notebook.cells[index].source = sourceArray;
    if (input.cellType) notebook.cells[index].cell_type = input.cellType;
    await fs.writeFile(target, JSON.stringify(notebook, null, 2), "utf8");
    return `Replaced cell at index ${index} in ${input.path}.`;
  }

  if (mode === "add_cell") {
    const sourceArray = input.source ? input.source.split("\n").map((line, i, arr) => i < arr.length - 1 ? line + "\n" : line) : [];
    const newCell = {
      cell_type: input.cellType ?? "code",
      metadata: {},
      source: sourceArray,
      ...(input.cellType === "code" ? { execution_count: null, outputs: [] } : {})
    };
    
    if (index >= 0 && index <= notebook.cells.length) {
      notebook.cells.splice(index, 0, newCell);
    } else {
      notebook.cells.push(newCell);
    }
    
    await fs.writeFile(target, JSON.stringify(notebook, null, 2), "utf8");
    return `Added new ${input.cellType ?? "code"} cell to ${input.path}.`;
  }

  return `Error: unknown notebook edit mode "${String(mode)}".`;
}
