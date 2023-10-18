// SPDX-License-Identifier: BUSL-1.1
const { setConfig, getConfig } = require("../../../config/configUtils.js");

module.exports = async function (
  { _ },
  {
    deployments: { deploy, getArtifact },
    ethers: {
      getContractAt,
      getNamedSigners,
      constants: { AddressZero },
    },
  },
) {
  const { deployer } = await getNamedSigners();

  const сurveAddressProviderArtifact = await getArtifact("AddressProvider");
  const сurveRegistryArtifact = await getArtifact("Registry");
  const сurveCryptoRegistryArtifact = await getArtifact("CryptoRegistry");
  const сurveSwapsArtifact = await getArtifact("Swaps");
  const сurveCalculatorArtifact = await getArtifact("CurveCalc");

  const CurveAddressProvider = await deploy("CurveAddressProvider", {
    contract: { abi: сurveAddressProviderArtifact.abi, bytecode: сurveAddressProviderArtifact.bytecode },
    from: deployer.address,
    args: [deployer.address],
    log: true,
  });

  const CurveCalculator = await deploy("CurveCalc", {
    contract: { abi: сurveCalculatorArtifact.abi, bytecode: сurveCalculatorArtifact.bytecode },
    from: deployer.address,
    args: [],
    log: true,
  });

  const CurveRegistry = await deploy("CurveRegistry", {
    contract: { abi: сurveRegistryArtifact.abi, bytecode: сurveRegistryArtifact.bytecode },
    from: deployer.address,
    args: [CurveAddressProvider.address, AddressZero],
    log: true,
  });

  const addressProvider = (await getContractAt("AddressProvider", CurveAddressProvider.address)).connect(deployer);

  let tx;
  if (CurveRegistry.newlyDeployed) {
    tx = await addressProvider.set_address(0, CurveRegistry.address);
    await tx.wait();
  }

  const CurveCryptoRegistry = await deploy("CurveCryptoRegistry", {
    contract: { abi: сurveCryptoRegistryArtifact.abi, bytecode: сurveCryptoRegistryArtifact.bytecode },
    from: deployer.address,
    args: [CurveAddressProvider.address],
    log: true,
  });

  if (CurveCryptoRegistry.newlyDeployed) {
    tx = await addressProvider.add_new_id(addressProvider.address, "None"); // 1
    await tx.wait();
    tx = await addressProvider.add_new_id(addressProvider.address, "Swap router"); // 2
    await tx.wait();
    tx = await addressProvider.add_new_id(CurveCryptoRegistry.address, "Pseudo factory registry"); // 3
    await tx.wait();
    tx = await addressProvider.add_new_id(addressProvider.address, "None"); // 4
    await tx.wait();

    tx = await addressProvider.add_new_id(CurveCryptoRegistry.address, "Crypto registry");
    await tx.wait();
  }

  const CurveSwapRouter = await deploy("CurveSwapRouter", {
    contract: { abi: сurveSwapsArtifact.abi, bytecode: сurveSwapsArtifact.bytecode },
    from: deployer.address,
    args: [CurveAddressProvider.address, CurveCalculator.address],
    log: true,
  });

  if (CurveSwapRouter.newlyDeployed) {
    tx = await addressProvider.set_address(2, CurveSwapRouter.address);
    await tx.wait();
  }

  const dexes = getConfig("dexes");

  const curveData = {
    router: CurveSwapRouter.address,
    type: "3",
    registry: CurveRegistry.address,
    cryptoRegistry: CurveCryptoRegistry.address,
  };
  dexes.curve = curveData;

  setConfig("dexes", dexes);

  return [CurveAddressProvider, CurveRegistry, CurveCryptoRegistry, CurveSwapRouter];
};
