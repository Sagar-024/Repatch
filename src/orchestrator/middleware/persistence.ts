import * as fs from "fs";
import * as path from "path";
import { AgentState } from "../state.js";
import { maskObject } from "../../utils/masking.js";

export class PersistenceMiddleware {
  private checkpointDir: string;
  private checkpointFile: string;

  constructor(repoPath: string) {
    this.checkpointDir = path.join(repoPath, ".repatch");
    this.checkpointFile = path.join(this.checkpointDir, "state.json");
  }

  /**
   * Saves the current agent state to disk, masking all secrets.
   */
  async save(state: AgentState): Promise<void> {
    try {
      if (!fs.existsSync(this.checkpointDir)) {
        fs.mkdirSync(this.checkpointDir, { recursive: true });
      }

      // Deep copy and mask
      const safeState = maskObject(state);
      
      fs.writeFileSync(
        this.checkpointFile, 
        JSON.stringify(safeState, null, 2), 
        "utf-8"
      );
      
      // console.log(`   💾 State checkpointed to .repatch/state.json`);
    } catch (error) {
      console.warn(`   ⚠️ Persistence Warning: Could not save state. Disk might be full. Error: ${error}`);
      // D13 - Fallback to memory-only is implicit as the state object remains in memory
    }
  }

  /**
   * Loads the state from disk if it exists.
   */
  load(): AgentState | null {
    if (fs.existsSync(this.checkpointFile)) {
      try {
        const data = fs.readFileSync(this.checkpointFile, "utf-8");
        return JSON.parse(data) as AgentState;
      } catch {
        return null;
      }
    }
    return null;
  }
}
