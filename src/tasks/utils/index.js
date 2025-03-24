// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("accounts", "Prints the list of accounts", require("./accounts"));

task("miner", "enable mining", require("./miner"));

task(
  "syncContractDataWithEthernal",
  "Push all contracts from the deployments folder to the ethernal via post request",
  require("./syncContractDataWithEthernal.js"),
);

task("upgradeContract", "Upgrade proxy contract to a new implementation", require("./upgradeContract"))
  .addParam("address", "Address of Proxy or Beacon contract")
  .addParam("newImplName", "Name of the new implementation contract")
  .addOptionalParam("oldImplName", "Name of the old implementation contract")
  .addOptionalParam("isBeacon", "Flag to indicate beacon proxy")
  .addOptionalParam("oldFactoryLibraries", "An Object of libraries for the old implementation factory")
  .addOptionalParam("newFactoryLibraries", "An Object of libraries for the new implementation factory")
  .addOptionalParam("primexProxyAdmin", "Address of the PrimexProxyAdmin");

task("AccessControl:AddRole", "only user with ", require("./addRole"))
  .addParam("role", "name ROLE to add")
  .addParam("account", "account to add role")
  .addOptionalParam("registryAddress", "address AccessControl contract(default is Primex Registry)");

task("customErrorDecode", "Decode custom error from hex to human readable format", require("./customErrorDecode")).addParam(
  "errorData",
  "Error data in hex format from contract",
);

task("configureObscuroWalletExtension", "Setup Obscuro Wallet Extension", require("./configureObscuroWalletExtension")).addParam(
  "from",
  "Signer name",
);

task("decodeFunctionData", require("./decodeFunctionData"))
  .addParam("contractAddress", "The address of the contract to call")
  .addParam("payload", "Encoded function data");

task("verifyArtifacts", "Verify deployed artifacts on block explorer", require("./verifyArtifacts"));

task("validateUpgrade", "Validate upgrade of two version of the protocol", require("./validateUpgrade"));

task("pullDepositManagerData", "", require("./pullDepositManagerData"));
