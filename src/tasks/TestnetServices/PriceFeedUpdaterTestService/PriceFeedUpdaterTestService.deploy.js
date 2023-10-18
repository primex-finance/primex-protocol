// SPDX-License-Identifier: BUSL-1.1
const { getConfig } = require("../../../config/configUtils.js");

module.exports = async function (
  { updater, errorsLibrary, dexAdapter, routers, primexPricingLibrary },
  {
    network,
    getNamedAccounts,
    deployments: { deploy },
    ethers: {
      getContract,
      getContractAt,
      utils: { toUtf8Bytes, keccak256 },
    },
  },
) {
  const { deployer } = await getNamedAccounts();

  if (!updater) {
    updater = deployer;
  }
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  const PriceFeedUpdaterTestService = await deploy("PriceFeedUpdaterTestService", {
    from: deployer,
    args: [updater, dexAdapter, JSON.parse(routers)],
    log: true,
    libraries: {
      errorsLibrary: errorsLibrary.address,
      PrimexPricingLibrary: primexPricingLibrary,
    },
  });
  if (process.env.FUZZING) {
    const priceFeedUpdaterTestService = await getContractAt("PriceFeedUpdaterTestService", PriceFeedUpdaterTestService.address);
    await priceFeedUpdaterTestService.grantRole(keccak256(toUtf8Bytes("DEFAULT_UPDATER_ROLE")), process.env.FUZZING_CONTRACT_ADDRESS);
  }

  if (PriceFeedUpdaterTestService.newlyDeployed && process.env.TEST === undefined && network.name !== "hardhat") {
    const {
      pricefeeds: { selfDeployed: pricefeeds },
      priceDropfeeds: { selfDeployed: priceDropfeeds },
    } = getConfig();
    const allFeeds = Object.values(pricefeeds).concat(Object.values(priceDropfeeds));
    for (const feedAddress of allFeeds) {
      await run("AccessControl:AddRole", {
        registryAddress: feedAddress,
        account: PriceFeedUpdaterTestService.address,
        role: "DEFAULT_UPDATER_ROLE",
      });
    }
  }
  return PriceFeedUpdaterTestService;
};
