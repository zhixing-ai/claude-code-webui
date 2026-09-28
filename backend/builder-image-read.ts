import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import sharp from "sharp";

const IMAGE = /\.(jpe?g|png|webp|gif|avif|heic|heif|tiff?|bmp)$/i;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PIXELS = 120_000_000;
const SAFE_PIXELS = 4_000_000;
const TILE = 2000;
const OVERLAP = 160;
// Bound libvips work across concurrent runs in this backend process.
sharp.cache({ memory: 8, files: 0, items: 0 });
sharp.concurrency(1);
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.catch(() => undefined);
  return result;
}
function offsets(size: number): number[] {
  const values = [0];
  while (values.at(-1)! + TILE < size) {
    values.push(Math.min(values.at(-1)! + TILE - OVERLAP, size - TILE));
  }
  return values;
}

/** Per-run, ephemeral derivatives. Originals are never rewritten. */
export class BuilderImageReadGuard {
  private directory?: string;
  private readonly jobs = new Map<string, Promise<string | undefined>>();
  constructor(private readonly workspace: string) {}

  async check(file: string): Promise<string | undefined> {
    if (!IMAGE.test(file)) return;
    try {
      const path = await realpath(resolve(this.workspace, file));
      if (
        this.directory &&
        relative(this.directory, path).split(/[\\/]/)[0] !== ".."
      ) {
        const m = await sharp(path, {
          limitInputPixels: SAFE_PIXELS,
        }).metadata();
        if (!m.width || !m.height || Math.max(m.width, m.height) > TILE)
          throw new Error("Derivative changed");
        return;
      }
      const root = await realpath(this.workspace);
      const rel = relative(root, path);
      if (rel.startsWith("..") || resolve(root, rel) !== path) {
        return "Image reading is limited to this Builder workspace. Copy the intended image into the workspace first.";
      }
      const info = await stat(path);
      if (!info.isFile() || info.size > MAX_BYTES)
        return "Image exceeds the 32 MiB preparation limit. The original was preserved; request a bounded preview instead of reading it directly.";
      const key = `${path}:${info.ino}:${info.size}:${info.mtimeMs}`;
      let job = this.jobs.get(key);
      if (!job) {
        job = serial(() => this.prepare(path));
        this.jobs.set(key, job);
      }
      return await job;
    } catch {
      return "Image preparation failed. The original was preserved. Do not bypass this failure by reading or decoding the original with another tool; report that this material could not be read.";
    }
  }

  private async prepare(path: string): Promise<string | undefined> {
    // metadata reads dimensions without expanding the bitmap.
    const options = { limitInputPixels: MAX_PIXELS, sequentialRead: true };
    const meta = await sharp(path, options).metadata();
    const { width, height } = meta;
    if (!width || !height || (meta.pages ?? 1) > 1)
      throw new Error("Unsupported image");
    if (width * height <= SAFE_PIXELS && Math.max(width, height) <= TILE)
      return;
    // JPEG has decoder downsampling. Do not fully decode huge PNG/TIFF/etc in 1GiB.
    if (meta.format !== "jpeg" && width * height > 16_000_000)
      throw new Error("Unsafe decoder size");
    this.directory ??= await realpath(
      await mkdtemp(join(tmpdir(), "builder-images-")),
    );
    const target = await mkdtemp(join(this.directory, "image-"));
    const prepared = join(target, "canvas.jpg");
    const size = await sharp(path, options)
      .rotate()
      .resize({
        width: 6000,
        height: 6000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 92 })
      .toFile(prepared);
    const files: string[] = [];
    for (const top of offsets(size.height)) {
      for (const left of offsets(size.width)) {
        const output = join(target, `tile-${files.length + 1}.jpg`);
        await sharp(prepared, options)
          .extract({
            left,
            top,
            width: Math.min(TILE, size.width),
            height: Math.min(TILE, size.height),
          })
          .jpeg({ quality: 92 })
          .toFile(output);
        files.push(output);
      }
    }
    await rm(prepared);
    return `The original image is too large for direct Read. It is preserved. Read these overlapping tiles in row-major order, one at a time; do not read or decode the original with another tool. These are resized views, not lossless evidence: mark uncertain small text/numbers as unreadable rather than guessing.\n${files.join("\n")}`;
  }

  async dispose(): Promise<void> {
    await Promise.allSettled(this.jobs.values());
    if (this.directory)
      await rm(this.directory, { recursive: true, force: true });
  }
}
