// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { getNamedAccounts, ethers: { getContract }, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();

  return await deploy("TokenApproveLibrary", {
    from: deployer,
    args: [],
    log: true,
  });
};
