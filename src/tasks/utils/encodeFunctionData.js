// SPDX-License-Identifier: BUSL-1.1
const hardhat = require("hardhat");
const { getContract, getContractAt } = hardhat.ethers;

async function encodeFunctionData(methodName, params, contractName, contractAddress) {
  let contract;
  if (contractAddress) {
    contract = await getContractAt(contractName, contractAddress);
  } else {
    contract = await getContract(contractName);
  }
  return {
    payload: contract.interface.encodeFunctionData(methodName, params),
    contractAddress: contract.address,
  };
}

module.exports = { encodeFunctionData };
