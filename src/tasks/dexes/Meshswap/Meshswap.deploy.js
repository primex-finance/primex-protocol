// SPDX-License-Identifier: BUSL-1.1
const { setConfig, getConfig } = require("../../../config/configUtils.js");

module.exports = async function (
  { _ },
  {
    getNamedAccounts,
    deployments: { deploy, getArtifact },
    ethers: {
      getContractAt,
      constants: { AddressZero },
    },
  },
) {
  const { deployer } = await getNamedAccounts();
  const routerImpl = await getArtifact("RouterImpl");
  const factoryImpl = await getArtifact("FactoryImpl");
  const exchangeImpl = await getArtifact("ExchangeImpl");

  const ExchangeImpl = await deploy("ExchangeImpl", {
    contract: { abi: exchangeImpl.abi, bytecode: exchangeImpl.bytecode },
    from: deployer,
    args: [],
    log: true,
  });

  const FactoryImpl = await deploy("FactoryImpl", {
    contract: { abi: factoryImpl.abi, bytecode: factoryImpl.bytecode },
    from: deployer,
    args: [],
    log: true,
  });

  const RouterImpl = await deploy("RouterImpl", {
    contract: { abi: routerImpl.abi, bytecode: routerImpl.bytecode },
    from: deployer,
    args: [],
    log: true,
  });

  const factory = await getArtifact("Factory");
  const router = await getArtifact("Router");

  const Factory = await deploy("MeshswapFactory", {
    contract: { abi: factory.abi, bytecode: factory.bytecode },
    from: deployer,
    args: [FactoryImpl.address, ExchangeImpl.address, AddressZero, AddressZero],
    log: true,
  });

  const Router = await deploy("MeshswapRouter", {
    contract: { abi: router.abi, bytecode: router.bytecode },
    from: deployer,
    args: [RouterImpl.address, Factory.address, AddressZero],
    log: true,
  });

  if (Factory.newlyDeployed) {
    const factoryImplContract = await getContractAt("FactoryImpl", Factory.address);
    const tx = await factoryImplContract.setRouter(Router.address);
    await tx.wait();
  }
  const dexes = getConfig("dexes");

  const meshswapData = {
    router: Router.address,
    type: "6",
    factory: Factory.address,
  };
  dexes.meshswap = meshswapData;

  setConfig("dexes", dexes);
};
