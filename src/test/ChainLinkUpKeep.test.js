// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    getNamedSigners,
    getContract,
    constants: { AddressZero },
  },
} = require("hardhat");
const { exec } = require("node:child_process");
const path = require("path");
const fs = require("fs");

process.env.TEST = true;

describe("ChainLinkUpKeep", function () {
  let LinkToken, KeeperRegistry, Counter, deployer, holder;

  // eslint-disable-next-line mocha/no-hooks-for-single-case
  before(async function () {
    ({ deployer, holder } = await getNamedSigners());
    await run("deploy:KeeperRegistry");
    await run("setup:chainLinkSetup");

    LinkToken = await getContract("LinkToken");
    KeeperRegistry = await getContract("KeeperRegistry");
    Counter = await getContract("Counter");
  });
  // eslint-disable-next-line mocha/no-hooks-for-single-case
  after(async function () {
    // if run this file separately then the deployment in the hardhat network
    // is not automatically deleted, then so that the next test run does not fail
    // need to do it manually
    const pathToNetworkDeployments = path.join(__dirname, "..", "deployments", network.name);
    fs.stat(pathToNetworkDeployments, function (err) {
      if (!err) exec(`rm -rf ${pathToNetworkDeployments}`);
    });
  });

  it("keeper's flow", async function () {
    // upkeep not needed
    expect((await Counter.checkUpkeep("0x00")).upkeepNeeded).to.equal(false);
    await expect(KeeperRegistry.connect(AddressZero).callStatic.checkUpkeep(0, deployer.address)).to.be.revertedWith("upkeep not needed");

    // upkeep needed
    let counter = await Counter.counter();
    await network.provider.send("evm_increaseTime", [61]);
    await network.provider.send("evm_mine");
    expect((await Counter.checkUpkeep("0x00")).upkeepNeeded).to.equal(true);
    expect(await KeeperRegistry.connect(AddressZero).callStatic.checkUpkeep(0, deployer.address));

    let keeperInfo = await KeeperRegistry.getKeeperInfo(deployer.address);
    expect(keeperInfo.payee).to.equal(deployer.address);
    expect(keeperInfo.active).to.equal(true);
    let balanceBefore = keeperInfo.balance;

    // deployer performUpkeep
    await KeeperRegistry.performUpkeep(0, "0x00");

    expect(await Counter.counter()).to.equal(counter.add(1));
    counter = counter.add(1);

    keeperInfo = await KeeperRegistry.getKeeperInfo(deployer.address);
    let balanceAfter = keeperInfo.balance;
    expect(balanceAfter).to.gt(balanceBefore);

    // deployer withdraw payment
    await expect(() => KeeperRegistry.withdrawPayment(deployer.address, deployer.address)).to.changeTokenBalance(
      LinkToken,
      deployer,
      balanceAfter.sub(balanceBefore),
    );
    await network.provider.send("evm_increaseTime", [61]);

    // upkeep needed
    await network.provider.send("evm_increaseTime", [61]);
    await network.provider.send("evm_mine");
    expect((await Counter.checkUpkeep("0x00")).upkeepNeeded).to.equal(true);
    expect(await KeeperRegistry.connect(AddressZero).callStatic.checkUpkeep(0, holder.address));
    keeperInfo = await KeeperRegistry.getKeeperInfo(holder.address);
    expect(keeperInfo.payee).to.equal(holder.address);
    expect(keeperInfo.active).to.equal(true);
    balanceBefore = keeperInfo.balance;

    // deployer can't performUpkeep for the second time in a row
    await expect(KeeperRegistry.connect(AddressZero).callStatic.checkUpkeep(0, deployer.address)).to.be.revertedWith(
      "keepers must take turns",
    );
    await expect(KeeperRegistry.performUpkeep(0, "0x00")).to.be.revertedWith("keepers must take turns");

    // holder performUpkeep
    await KeeperRegistry.connect(holder).performUpkeep(0, "0x00");

    expect(await Counter.counter()).to.equal(counter.add(1));
    counter = counter.add(1);

    keeperInfo = await KeeperRegistry.getKeeperInfo(holder.address);
    balanceAfter = keeperInfo.balance;
    expect(balanceAfter).to.gt(balanceBefore);

    // holder withdraw payment
    await expect(() => KeeperRegistry.connect(holder).withdrawPayment(holder.address, holder.address)).to.changeTokenBalance(
      LinkToken,
      holder,
      balanceAfter.sub(balanceBefore),
    );
  });
});
