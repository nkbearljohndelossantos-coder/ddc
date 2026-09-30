import fs from 'fs';
import path from 'path';

export const SUPPORTED_EXTENSIONS = new Set([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.tiff',
  '.tif',
]);

export interface DiscoveredFile {
  filePath: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
}

export class FolderWatcher {
  private watchFolder: string;
  private isWatching: boolean = false;
  private knownFiles: Set<string> = new Set();

  constructor(watchFolder: string) {
    this.watchFolder = watchFolder;
  }

  public ensureDirectoriesExist(additionalDirs: string[] = []): void {
    if (!fs.existsSync(this.watchFolder)) {
      fs.mkdirSync(this.watchFolder, { recursive: true });
    }
    for (const dir of additionalDirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  public isSupportedFile(fileName: string): boolean {
    // Ignore hidden or temporary files
    if (fileName.startsWith('.') || fileName.startsWith('~') || fileName.endsWith('.tmp')) {
      return false;
    }
    const ext = path.extname(fileName).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
  }

  /**
   * Checks if a file is fully written and no longer locked by external scanner software.
   */
  public async isFileStable(filePath: string, checkDelayMs = 400): Promise<boolean> {
    try {
      const stats1 = fs.statSync(filePath);
      if (stats1.size === 0) {
        return false; // File is still being created/empty
      }

      await new Promise((resolve) => setTimeout(resolve, checkDelayMs));

      if (!fs.existsSync(filePath)) {
        return false;
      }

      const stats2 = fs.statSync(filePath);
      if (stats1.size !== stats2.size) {
        return false; // Still writing
      }

      // Try opening the file exclusively in read mode to ensure external lock is released
      const fd = fs.openSync(filePath, 'r');
      fs.closeSync(fd);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Scans the watch directory for newly arrived and stable document files.
   */
  public async scanFolder(): Promise<DiscoveredFile[]> {
    if (!fs.existsSync(this.watchFolder)) {
      return [];
    }

    const discovered: DiscoveredFile[] = [];
    const entries = fs.readdirSync(this.watchFolder, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && this.isSupportedFile(entry.name)) {
        const fullPath = path.join(this.watchFolder, entry.name);
        const stable = await this.isFileStable(fullPath);
        if (stable) {
          const stats = fs.statSync(fullPath);
          discovered.push({
            filePath: fullPath,
            fileName: entry.name,
            extension: path.extname(entry.name).toLowerCase(),
            sizeBytes: stats.size,
          });
        }
      }
    }

    return discovered;
  }
}
