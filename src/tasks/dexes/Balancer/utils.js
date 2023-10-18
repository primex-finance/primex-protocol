// SPDX-License-Identifier: BUSL-1.1
const { getBalancerContractBytecode, getBalancerContractAbi } = require("@balancer-labs/v2-deployments");

const packageEnum = Object.freeze({
  Vault: "20210418-vault",
  WeightedPoolFactory: "20210418-weighted-pool",
  WeightedPool: "20210418-weighted-pool",
  StablePoolFactory: "20210624-stable-pool",
  Authorizer: "20210418-authorizer",
});

async function getContractAbi(name) {
  const abi = await getBalancerContractAbi(packageEnum[name], name);
  return abi;
}

async function getContractByteCode(name) {
  const byteCode = await getBalancerContractBytecode(packageEnum[name], name);
  return byteCode;
}

module.exports = { getContractAbi, getContractByteCode };
