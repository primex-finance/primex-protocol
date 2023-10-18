// SPDX-License-Identifier: BUSL-1.1
const { getConfig } = require("../../../config/configUtils.js");

module.exports = async function ({ _ }, { ethers: { getContract } }) {
  const { aave } = getConfig();
  const PrimexDNS = await getContract("PrimexDNS");
  const tx = await PrimexDNS.setAavePool(aave);
  await tx.wait();
};
