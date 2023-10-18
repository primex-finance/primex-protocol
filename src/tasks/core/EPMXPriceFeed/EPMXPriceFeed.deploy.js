// SPDX-License-Identifier: BUSL-1.1
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

  const EPMXPriceFeed = await deploy("EPMXPriceFeed", {
    from: deployer,
    log: true,
    args: [registry],
    libraries: {
      Errors: errorsLibrary,
    },
  });
  if (EPMXPriceFeed.newlyDeployed) {
    const EPMXPriceFeedContract = await getContract("EPMXPriceFeed");
    const tx = await EPMXPriceFeedContract.setAnswer(price);
    await tx.wait();
  }
  return EPMXPriceFeed;
};
