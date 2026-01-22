import { existsSync } from "node:fs";
import { mkdir, rm, cp } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const srcDir = path.join(rootDir, "2.0案例生成器");
const outDir = path.join(rootDir, "dist");

if (!existsSync(srcDir)) {
  console.error(`[build] 未找到前端目录: ${srcDir}`);
  process.exit(1);
}

// 清空 dist
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// 拷贝静态文件到 dist
await cp(srcDir, outDir, { recursive: true });

console.log(`[build] 输出目录: ${outDir}`);
