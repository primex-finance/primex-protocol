module.exports = {
  env: {
    es6: true,
    node: true,
  },
  extends: ["standard", "eslint:recommended", "plugin:node/recommended", "plugin:mocha/recommended", "prettier"],
  globals: {
    Atomics: "readonly",
    SharedArrayBuffer: "readonly",
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
  },
  rules: {
    indent: ["error", 2],
    "linebreak-style": ["error", process.platform === "win32" ? "windows" : "unix"],
    quotes: ["error", "double"],
    semi: ["error", "always"],
    "node/no-unpublished-require": "off",
    "node/no-extraneous-require": [
      "error",
      {
        allowModules: ["@cryptoalgebra-fork/src"],
      },
    ],
    "mocha/no-hooks-for-single-case": "error",
  },
  plugins: ["prettier"],
};
