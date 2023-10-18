// SPDX-License-Identifier: BUSL-1.1
const {
  network,
  ethers: {
    Wallet,
    getContract,
    getSigner,
    provider,
    BigNumber,
    utils: { parseEther },
  },
} = require("hardhat");
const { EMERGENCY_ADMIN } = require("../../Constants");

async function increaseBlocksBy(blocksNumber) {
  // replace is necessary because hex quantities with leading zeros are not valid at the JSON-RPC layer
  await provider.send("hardhat_mine", [BigNumber.from(blocksNumber).toHexString().replace("0x0", "0x")]);
}

async function getImpersonateSigner(account) {
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [account.address],
  });

  await network.provider.send("hardhat_setBalance", [account.address, parseEther("1000").toHexString()]);
  return await getSigner(account.address);
}
async function getAdminSigners() {
  let BigTimelockAdmin = await getContract("BigTimelockAdmin");
  BigTimelockAdmin = await getImpersonateSigner(BigTimelockAdmin);

  let MediumTimelockAdmin = await getContract("MediumTimelockAdmin");
  MediumTimelockAdmin = await getImpersonateSigner(MediumTimelockAdmin);

  let SmallTimelockAdmin = await getContract("SmallTimelockAdmin");
  SmallTimelockAdmin = await getImpersonateSigner(SmallTimelockAdmin);

  let EmergencyAdmin = Wallet.createRandom();
  EmergencyAdmin = EmergencyAdmin.connect(BigTimelockAdmin.provider);
  await network.provider.send("hardhat_setBalance", [EmergencyAdmin.address, parseEther("1000").toHexString()]);
  const registry = await getContract("Registry");
  await registry.grantRole(EMERGENCY_ADMIN, EmergencyAdmin.address);

  return {
    BigTimelockAdmin: BigTimelockAdmin,
    MediumTimelockAdmin: MediumTimelockAdmin,
    SmallTimelockAdmin: SmallTimelockAdmin,
    EmergencyAdmin: EmergencyAdmin,
  };
}

module.exports = { increaseBlocksBy, getImpersonateSigner, getAdminSigners };
