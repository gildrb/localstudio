export default {
  project: ["src/**/*.ts"],
  ignore: ["bun.lockb", "node_modules/**", "dist/**", "src/**/index.ts"],
  ignoreBinaries: ["knip"],
  ignoreExportsUsedInFile: true,
  ignoreWorkspaces: [],
};
