// SPDX-License-Identifier: BUSL-1.1
const { getConfig, setConfig } = require("../../../config/configUtils");

module.exports = async function (
  { registry, errorsLibrary, price },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract } },
) {
  if (!registry) {
    registry = (await getContract("Registry")).address;
  }
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }
  const { deployer } = await getNamedAccounts();

  const { pricefeeds } = getConfig();

  const PMXPriceFeed = await deploy("PMXPriceFeed", {
    from: deployer,
    log: true,
    args: [registry],
    libraries: {
      Errors: errorsLibrary,
    },
  });
  if (PMXPriceFeed.newlyDeployed) {
    if (price) {
      const EPMXPriceFeedContract = await getContract("PMXPriceFeed");
      const tx = await EPMXPriceFeedContract.setAnswer(price);
      await tx.wait();
    }
    pricefeeds.selfDeployed["epmx-usd"] = PMXPriceFeed.address;
    setConfig("pricefeeds", pricefeeds);
  }
  return PMXPriceFeed;
};
