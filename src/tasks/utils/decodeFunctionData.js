// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ contractAddress, payload }, { deployments, ethers: { utils } }) {
  const allDeployments = Object.values(await deployments.all());
  const deployment = allDeployments.find(item => item.address === contractAddress);
  if (!deployment) {
    console.log("No contract found with specified address");
    return [];
  }
  const iface = new utils.Interface(deployment.abi);

  console.log("Decoded function data2: ", iface.parseTransaction({ data: payload }));
};
