// SPDX-License-Identifier: BUSL-1.1

// yarn hardhat node --no-deploy
// yarn hardhat deployFull:devnode1 --network localhost
// yarn hardhat positionToCloseByLiq --network localhost
// yarn hardhat closePos --id {id} --network localhost

// testTokenA = USDC
// testTokenB = WBTC

module.exports = async function ({ id }, { ethers: { getNamedSigners, getContract } }) {
  const { getSingleRoute } = require("../../test/utils/dexOperations");
  const { taskSetup, getTraderPositions } = require("./taskSetup");

  const { deployer } = await getNamedSigners();

  const dex = "uniswap";
  const setup = await taskSetup();
  const positionManager = await getContract("PositionManager");
  const routesForClose = await getSingleRoute([setup.testTokenBaddress, setup.testTokenAaddress], dex);

  const tx = await positionManager.closePosition(id, deployer.address, routesForClose, 0);
  await tx.wait();
  console.log(`Position ${id} is closed`);

  await getTraderPositions();
  console.log("-----------------");
};
