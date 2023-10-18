// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ recipient }, { getNamedAccounts, deployments: { deploy }, ethers: { getContract } }) {
  const { deployer } = await getNamedAccounts();

  return await deploy("PMXToken", {
    from: deployer,
    args: [recipient],
    log: true,
  });
};
