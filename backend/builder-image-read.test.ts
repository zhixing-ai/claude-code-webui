import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { BuilderImageReadGuard } from "./builder-image-read.ts";

const roots: string[] = [];
const guards: BuilderImageReadGuard[] = [];
afterEach(async () => {
  await Promise.all(guards.splice(0).map((g) => g.dispose()));
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "image-guard-test-"));
  roots.push(root);
  const guard = new BuilderImageReadGuard(root);
  guards.push(guard);
  return { root, guard };
}
describe("Builder image Read", () => {
  it("passes ordinary images and text through", async () => {
    const { root, guard } = await fixture();
    await sharp({
      create: { width: 100, height: 100, channels: 3, background: "white" },
    })
      .jpeg()
      .toFile(join(root, "small.jpg"));
    expect(await guard.check("small.jpg")).toBeUndefined();
    expect(await guard.check("SKILL.md")).toBeUndefined();
  });
  it("denies original Read with bounded overlapping tiles, preserves original and cleans derivatives", async () => {
    const { root, guard } = await fixture();
    const source = join(root, "large.jpg");
    await sharp({
      create: { width: 2600, height: 3100, channels: 3, background: "white" },
    })
      .jpeg()
      .toFile(source);
    const before = await readFile(source);
    const [reason, same] = await Promise.all([
      guard.check(source),
      guard.check(source),
    ]);
    expect(reason).toBe(same);
    const paths = reason!.split("\n").slice(1);
    expect(paths.length).toBe(4);
    for (const path of paths) {
      const metadata = await sharp(path).metadata();
      expect(metadata.width).toBeLessThanOrEqual(2000);
      expect(metadata.height).toBeLessThanOrEqual(2000);
      expect(await guard.check(path)).toBeUndefined();
    }
    expect(await readFile(source)).toEqual(before);
    await guard.dispose();
    await expect(readFile(paths[0])).rejects.toThrow();
    expect(await readFile(source)).toEqual(before);
  });
  it("fails closed for corrupt images and out-of-workspace paths", async () => {
    const { root, guard } = await fixture();
    await writeFile(join(root, "bad.jpg"), "not a jpeg");
    expect(await guard.check("bad.jpg")).toContain("preparation failed");
    const other = await fixture();
    await writeFile(join(other.root, "private.png"), "not a png");
    expect(await guard.check(join(other.root, "private.png"))).toContain(
      "limited to this Builder",
    );
  });
  it("rejects oversized non-JPEG before decoding pixels", async () => {
    const { root, guard } = await fixture();
    await sharp({
      create: { width: 4100, height: 4100, channels: 3, background: "white" },
    })
      .png()
      .toFile(join(root, "large.png"));
    expect(await guard.check("large.png")).toContain("preparation failed");
  });
});
