// SPDX-License-Identifier: BUSL-1.1
const { getContractAbi, getContractByteCode } = require("./utils.js");
const { setConfig, getConfig } = require("../../../config/configUtils.js");

module.exports = async function (
  { _ },
  {
    getNamedAccounts,
    deployments: { deploy },
    ethers: {
      constants: { AddressZero },
    },
  },
) {
  const { deployer } = await getNamedAccounts();

  const MONTH = 60 * 60 * 24 * 30;

  const vaultAbi = await getContractAbi("Vault");
  const weightedFactoryAbi = await getContractAbi("WeightedPoolFactory");
  const authorizerAbi = await getContractAbi("Authorizer");

  const vaultByteCode = await getContractByteCode("Vault");
  const weightedFactoryByteCode = await getContractByteCode("WeightedPoolFactory");
  const authorizerByteCode = await getContractByteCode("Authorizer");

  const BalancerAuthorizer = await deploy("Authorizer", {
    contract: { abi: authorizerAbi, bytecode: authorizerByteCode },
    from: deployer,
    args: [deployer],
    log: true,
  });

  const BalancerVault = await deploy("Vault", {
    contract: { abi: vaultAbi, bytecode: vaultByteCode },
    from: deployer,
    args: [BalancerAuthorizer.address, AddressZero, MONTH, MONTH],
    log: true,
  });

  const BalancerWeighedPoolFactory = await deploy("WeightedPoolFactory", {
    contract: { abi: weightedFactoryAbi, bytecode: weightedFactoryByteCode },
    from: deployer,
    args: [BalancerVault.address],
    log: true,
  });

  const dexes = getConfig("dexes");

  const balancerData = {
    router: BalancerVault.address,
    type: "4",
    weightedPoolFactory: BalancerWeighedPoolFactory.address,
  };
  dexes.balancer = balancerData;

  setConfig("dexes", dexes);

  return [BalancerAuthorizer, BalancerVault, BalancerWeighedPoolFactory];
};
