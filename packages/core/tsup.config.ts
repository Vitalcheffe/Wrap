import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    sandbox: 'src/sandbox/index.ts',
    agent: 'src/agent/index.ts',
    tools: 'src/tools/index.ts',
    mcp: 'src/mcp/index.ts',
    safety: 'src/safety/index.ts',
    vfs: 'src/vfs/index.ts',
    telemetry: 'src/telemetry/index.ts',
    utils: 'src/utils/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  treeshake: true,
  external: ['isolated-vm', 'dockerode', 'ws'],
});
