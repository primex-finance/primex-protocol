// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { name, symbol, decimals, initialSupply },
  {
    deployments: { deploy },
    ethers: {
      getNamedSigners,
      utils: { parseUnits },
    },
  },
) {
  const { deployer } = await getNamedSigners();

  return await deploy(name, {
    from: deployer.address,
    contract: "TetherToken",
    args: [initialSupply, name, symbol, decimals],
    log: !process.env.TEST,
  });
};
