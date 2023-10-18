// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  // before that, disable docgen plugin
  process.env.ZK_SYNC2 = true;
  await run("setup:deployEnv", {
    deployUniswap: true,
  });
};
