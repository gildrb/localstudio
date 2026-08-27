import babelConfig from "./babel.config.js";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const config = {
  plugins: {
    "@stylexjs/postcss-plugin": {
      cwd: projectRoot,
      include: ["src/**/*.{js,jsx,ts,tsx}"],
      babelConfig: {
        babelrc: false,
        parserOpts: { plugins: ["typescript", "jsx"] },
        plugins: babelConfig.plugins,
      },
      useCSSLayers: false,
    },
    "@tailwindcss/postcss": {},
    autoprefixer: {},
  },
};

export default config;
