// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName } = require("../../config/configUtils");
module.exports = async ({
  run,
  ethers: {
    getContract,
    utils: { parseEther },
  },
}) => {
  const registry = await getContract("Registry");
  const primexDNS = await getContract("PrimexDNS");
  const whiteBlackList = await getContract("WhiteBlackList");
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const errorsLibrary = await getContract("Errors");

  const { FlashLoanManagerConfig } = getConfigByName("generalConfig.json");
  const flashLoanFeeRate = parseEther(FlashLoanManagerConfig.flashLoanFeeRate).toString();
  const flashLoanProtocolRate = parseEther(FlashLoanManagerConfig.flashLoanProtocolRate).toString();

  await run("deploy:FlashLoanManager", {
    registry: registry.address,
    primexDNS: primexDNS.address,
    whiteBlackList: whiteBlackList.address,
    flashLoanFeeRate: flashLoanFeeRate,
    flashLoanProtocolRate: flashLoanProtocolRate,
    tokenTransfersLibrary: tokenTransfersLibrary.address,
    errorsLibrary: errorsLibrary.address,
  });
};
module.exports.tags = ["FlashLoanManager", "Test", "PrimexCore"];
module.exports.dependencies = ["PrimexDNS", "WhiteBlackList", "Registry", "TokenTransfersLibrary", "Errors"];
