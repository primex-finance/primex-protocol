// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  await run("phaseSwitch:bonusNFTs", { isExecute: true });
  console.log("=== finished ===");
};
